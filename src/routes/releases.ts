import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonStore } from '../lib/storage.js';
import { makeId, nowIso } from '../lib/id.js';
import { requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/auditLog.js';
import { fetchGitHubRelease, fetchLatestGitHubRelease, selectGitHubAsset, versionFromTag } from '../services/githubImport.js';
import type { Env } from '../config/env.js';
import type { AppRelease, GitHubAppSource, ReleaseChannel } from '../types.js';
import { detectPackageKind, validatePackageMetadata } from '../services/packageValidator.js';

const releaseSchema = z.object({
  version: z.string().min(1),
  channel: z.enum(['stable','beta','dev']).default('stable'),
  platform: z.string().min(1),
  packageUrl: z.string().min(1),
  sizeBytes: z.coerce.number().optional(),
  entrypoint: z.string().min(1),
  installType: z.enum(['portable','installer']).default('portable'),
  changelog: z.array(z.string()).default([]),
  releaseNotes: z.string().optional(),
});

const githubSourceSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  channel: z.enum(['stable','beta','dev']).default('stable'),
  platform: z.string().min(1).default('windows-x64'),
  assetPattern: z.string().min(1).default('*.zip'),
  entrypoint: z.string().min(1).default('echo-app.json'),
  installType: z.enum(['portable','installer']).default('portable'),
  includePrereleases: z.coerce.boolean().default(false),
  tag: z.string().optional(),
});

const githubImportSchema = githubSourceSchema.extend({
  appId: z.string().min(1),
});

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function compareVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10));
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = Number.isFinite(pa[i]) ? pa[i] : 0;
    const bv = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (av !== bv) return av - bv;
  }
  return a.localeCompare(b);
}

function newestRelease(releases: AppRelease[]): AppRelease | undefined {
  return [...releases].sort((a, b) => compareVersion(a.version, b.version))[releases.length - 1];
}

async function resolveGitHubSource(input: z.infer<typeof githubSourceSchema>, env: Env) {
  const release = input.tag
    ? await fetchGitHubRelease({ owner: input.owner, repo: input.repo, tag: input.tag, token: env.githubToken })
    : await fetchLatestGitHubRelease({ owner: input.owner, repo: input.repo, channel: input.channel, includePrereleases: input.includePrereleases, token: env.githubToken });
  const asset = selectGitHubAsset(release, input.assetPattern);
  if (!asset) throw new Error('GitHub release has no downloadable assets matching the asset pattern.');
  return { release, asset };
}

function buildSource(input: z.infer<typeof githubSourceSchema>, release: Awaited<ReturnType<typeof resolveGitHubSource>>['release'], asset: Awaited<ReturnType<typeof resolveGitHubSource>>['asset'], updateAvailable: boolean): GitHubAppSource {
  return {
    type: 'github_release',
    owner: input.owner,
    repo: input.repo,
    channel: input.channel as ReleaseChannel,
    platform: input.platform,
    assetPattern: input.assetPattern,
    entrypoint: input.entrypoint,
    installType: input.installType,
    includePrereleases: input.includePrereleases,
    tag: input.tag,
    latestTag: release.tagName,
    latestName: release.name,
    latestAssetName: asset.name,
    latestAssetUrl: asset.browser_download_url,
    latestAssetSize: asset.size,
    latestCheckedAt: nowIso(),
    updateAvailable,
  };
}

function hasPublishedRelease(releases: AppRelease[], appId: string, version: string, platform: string, channel: string): boolean {
  return releases.some((item) => item.appId === appId && item.version === version && item.platform === platform && item.channel === channel && item.status === 'published');
}

function makeGitHubRelease(input: z.infer<typeof githubSourceSchema>, appId: string, release: Awaited<ReturnType<typeof resolveGitHubSource>>['release'], asset: Awaited<ReturnType<typeof resolveGitHubSource>>['asset']): AppRelease {
  const validation = validatePackageMetadata({ fileName: asset.name, sizeBytes: asset.size, version: versionFromTag(release.tagName), platform: input.platform, entrypoint: input.entrypoint || 'echo-app.json', installType: input.installType });
  if (!validation.ok) throw new Error(`GitHub package validation failed: ${validation.errors.join(' ')}`);
  return {
    id: makeId('rel'),
    appId,
    version: versionFromTag(release.tagName),
    channel: input.channel,
    platform: input.platform,
    packageUrl: asset.browser_download_url,
    packageFileName: asset.name,
    sizeBytes: asset.size,
    entrypoint: input.entrypoint || 'echo-app.json',
    installType: input.installType,
    sourceType: 'github_release',
    sourceRepo: `${input.owner}/${input.repo}`,
    sourceTag: release.tagName,
    sourceAssetName: asset.name,
    packageKind: detectPackageKind(asset.name),
    validation,
    changelog: release.body.split('\n').filter(Boolean),
    releaseNotes: release.name,
    status: 'draft',
    createdAt: nowIso(),
  };
}

export function releaseRoutes(store: JsonStore, env: Env): Router {
  const router = Router();
  const tmpDir = join(env.dataDir, 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  const upload = multer({ dest: tmpDir, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

  router.get('/admin', ...requirePermission(store, 'releases.create'), (_req, res) => {
    const db = store.read();
    res.json({ releases: db.releases });
  });

  router.post('/admin/apps/:appId/releases', ...requirePermission(store, 'releases.create'), (req: AuthedRequest, res) => {
    const parsed = releaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const release = store.update((db) => {
      const app = db.apps.find((a) => a.id === req.params.appId);
      if (!app) return null;
      const item = { id: makeId('rel'), appId: req.params.appId, status: 'draft' as const, sourceType: 'upload' as const, createdAt: nowIso(), ...parsed.data };
      db.releases.push(item);
      return item;
    });
    if (!release) return res.status(404).json({ error: 'App not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.created', targetType: 'release', targetId: release.id });
    res.status(201).json({ release });
  });

  router.post('/admin/package/validate', ...requirePermission(store, 'releases.create'), upload.single('file'), (req: AuthedRequest, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Missing package file.' });
      const parsed = releaseSchema.omit({ packageUrl: true, sizeBytes: true, changelog: true, releaseNotes: true }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const report = validatePackageMetadata({ fileName: req.file.originalname || 'package.echoapp', sizeBytes: req.file.size, version: parsed.data.version, platform: parsed.data.platform, entrypoint: parsed.data.entrypoint, installType: parsed.data.installType });
      rmSync(req.file.path, { force: true });
      res.status(report.ok ? 200 : 400).json({ report });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Package validation failed.' });
    }
  });

  router.post('/admin/apps/:appId/releases/upload', ...requirePermission(store, 'releases.create'), upload.single('file'), (req: AuthedRequest, res) => {
    if (!req.file) return res.status(400).json({ error: 'Missing package file.' });
    const parsed = releaseSchema.omit({ packageUrl: true, sizeBytes: true }).safeParse({ ...req.body, changelog: String(req.body.changelog ?? '').split('\n').filter(Boolean) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const validation = validatePackageMetadata({ fileName: req.file.originalname || 'package.echoapp', sizeBytes: req.file.size, version: parsed.data.version, platform: parsed.data.platform, entrypoint: parsed.data.entrypoint, installType: parsed.data.installType });
    if (!validation.ok) { rmSync(req.file.path, { force: true }); return res.status(400).json({ error: `Package validation failed: ${validation.errors.join(' ')}`, report: validation }); }
    const releaseId = makeId('rel');
    const fileName = `${releaseId}-${safeFileName(req.file.originalname || 'package.zip')}`;
    const targetDir = join(env.dataDir, 'packages', req.params.appId, parsed.data.version, parsed.data.platform);
    mkdirSync(targetDir, { recursive: true });
    renameSync(req.file.path, join(targetDir, fileName));
    const packageUrl = `${env.publicBaseUrl}/packages/${req.params.appId}/${parsed.data.version}/${parsed.data.platform}/${fileName}`;
    const release = store.update((db) => {
      const app = db.apps.find((a) => a.id === req.params.appId);
      if (!app) return null;
      const item = { id: releaseId, appId: req.params.appId, status: 'draft' as const, sourceType: 'upload' as const, createdAt: nowIso(), packageUrl, packageFileName: fileName, sizeBytes: req.file?.size, packageKind: detectPackageKind(req.file?.originalname || fileName), validation, ...parsed.data };
      db.releases.push(item);
      return item;
    });
    if (!release) return res.status(404).json({ error: 'App not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.package.uploaded', targetType: 'release', targetId: release.id });
    res.status(201).json({ release });
  });

  router.post('/admin/github-source/test', ...requirePermission(store, 'releases.create'), async (req, res) => {
    try {
      const parsed = githubSourceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const { release, asset } = await resolveGitHubSource(parsed.data, env);
      const validation = validatePackageMetadata({ fileName: asset.name, sizeBytes: asset.size, version: versionFromTag(release.tagName), platform: parsed.data.platform, entrypoint: parsed.data.entrypoint, installType: parsed.data.installType });
      res.json({ ok: validation.ok, release: { tagName: release.tagName, name: release.name, prerelease: release.prerelease, asset, validation } });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'GitHub source test failed.' });
    }
  });

  router.post('/admin/apps/:appId/github-source', ...requirePermission(store, 'releases.create'), async (req: AuthedRequest, res) => {
    try {
      const parsed = githubSourceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const { release, asset } = await resolveGitHubSource(parsed.data, env);
      const version = versionFromTag(release.tagName);
      const app = store.update((db) => {
        const item = db.apps.find((a) => a.id === req.params.appId);
        if (!item) return null;
        item.githubSource = buildSource(parsed.data, release, asset, !hasPublishedRelease(db.releases, item.id, version, parsed.data.platform, parsed.data.channel));
        item.updatedAt = nowIso();
        return item;
      });
      if (!app) return res.status(404).json({ error: 'App not found.' });
      writeAudit(store, { actorUserId: req.user?.id, action: 'admin.app.github_source.saved', targetType: 'app', targetId: req.params.appId, details: { repo: `${parsed.data.owner}/${parsed.data.repo}`, tag: release.tagName } });
      res.json({ app, source: app.githubSource });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'GitHub source save failed.' });
    }
  });

  router.post('/admin/apps/:appId/github-source/check', ...requirePermission(store, 'releases.create'), async (req: AuthedRequest, res) => {
    try {
      const db = store.read();
      const existing = db.apps.find((a) => a.id === req.params.appId)?.githubSource;
      const parsed = githubSourceSchema.safeParse({ ...(existing ?? {}), ...(req.body ?? {}) });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const { release, asset } = await resolveGitHubSource(parsed.data, env);
      const version = versionFromTag(release.tagName);
      const app = store.update((nextDb) => {
        const item = nextDb.apps.find((a) => a.id === req.params.appId);
        if (!item) return null;
        item.githubSource = buildSource(parsed.data, release, asset, !hasPublishedRelease(nextDb.releases, item.id, version, parsed.data.platform, parsed.data.channel));
        item.updatedAt = nowIso();
        return item;
      });
      if (!app) return res.status(404).json({ error: 'App not found.' });
      writeAudit(store, { actorUserId: req.user?.id, action: 'admin.app.github_source.checked', targetType: 'app', targetId: req.params.appId, details: { tag: release.tagName, updateAvailable: app.githubSource?.updateAvailable } });
      res.json({ app, source: app.githubSource });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'GitHub source check failed.' });
    }
  });

  router.post('/admin/apps/:appId/github-source/import-latest', ...requirePermission(store, 'releases.create'), async (req: AuthedRequest, res) => {
    try {
      const db = store.read();
      const existing = db.apps.find((a) => a.id === req.params.appId)?.githubSource;
      const parsed = githubSourceSchema.safeParse({ ...(existing ?? {}), ...(req.body ?? {}) });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const { release, asset } = await resolveGitHubSource(parsed.data, env);
      const version = versionFromTag(release.tagName);
      const result = store.update((nextDb) => {
        const app = nextDb.apps.find((a) => a.id === req.params.appId);
        if (!app) return null;
        const existingRelease = nextDb.releases.find((item) => item.appId === app.id && item.version === version && item.platform === parsed.data.platform && item.channel === parsed.data.channel && item.sourceType === 'github_release');
        const rel = existingRelease ?? makeGitHubRelease(parsed.data, app.id, release, asset);
        if (!existingRelease) nextDb.releases.push(rel);
        app.githubSource = { ...buildSource(parsed.data, release, asset, !hasPublishedRelease(nextDb.releases, app.id, version, parsed.data.platform, parsed.data.channel)), lastImportedTag: release.tagName, lastImportedReleaseId: rel.id };
        app.updatedAt = nowIso();
        return { app, release: rel, existing: Boolean(existingRelease) };
      });
      if (!result) return res.status(404).json({ error: 'App not found.' });
      writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.github.imported', targetType: 'release', targetId: result.release.id, details: { repo: `${parsed.data.owner}/${parsed.data.repo}`, tag: release.tagName, existing: result.existing } });
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'GitHub release import failed.' });
    }
  });

  router.post('/admin/releases/import-github', ...requirePermission(store, 'releases.create'), async (req: AuthedRequest, res) => {
    try {
      const parsed = githubImportSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const { release, asset } = await resolveGitHubSource(parsed.data, env);
      const imported = store.update((db) => {
        const app = db.apps.find((a) => a.id === parsed.data.appId);
        if (!app) return null;
        const item = makeGitHubRelease(parsed.data, app.id, release, asset);
        db.releases.push(item);
        return item;
      });
      if (!imported) return res.status(404).json({ error: 'App not found.' });
      writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.github.imported', targetType: 'release', targetId: imported.id, details: { tag: release.tagName } });
      res.status(201).json({ release: imported });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'GitHub release import failed.' });
    }
  });

  router.post('/admin/releases/:id/submit-review', ...requirePermission(store, 'releases.create'), (req: AuthedRequest, res) => {
    const release = store.update((db) => {
      const item = db.releases.find((r) => r.id === req.params.id);
      if (!item) return null;
      item.status = 'pending_review';
      item.submittedAt = nowIso();
      return item;
    });
    if (!release) return res.status(404).json({ error: 'Release not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.submitted', targetType: 'release', targetId: req.params.id });
    res.json({ release });
  });

  router.post('/admin/releases/:id/reject', ...requirePermission(store, 'releases.approve'), (req: AuthedRequest, res) => {
    const release = store.update((db) => {
      const item = db.releases.find((r) => r.id === req.params.id);
      if (!item) return null;
      item.status = 'rejected';
      item.rejectedAt = nowIso();
      item.rejectedBy = req.user?.id;
      item.rejectReason = String(req.body.reason ?? 'Rejected by reviewer.');
      return item;
    });
    if (!release) return res.status(404).json({ error: 'Release not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.rejected', targetType: 'release', targetId: req.params.id });
    res.json({ release });
  });

  router.post('/admin/releases/:id/approve', ...requirePermission(store, 'releases.approve'), (req: AuthedRequest, res) => {
    const updated = store.update((db) => {
      const release = db.releases.find((r) => r.id === req.params.id);
      if (!release) return null;
      release.status = 'approved';
      release.approvedAt = nowIso();
      release.approvedBy = req.user?.id;
      return release;
    });
    if (!updated) return res.status(404).json({ error: 'Release not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.approved', targetType: 'release', targetId: req.params.id });
    res.json({ release: updated });
  });

  router.post('/admin/releases/:id/publish', ...requirePermission(store, 'releases.publish'), (req: AuthedRequest, res) => {
    const updated = store.update((db) => {
      const release = db.releases.find((r) => r.id === req.params.id);
      if (!release) return null;
      if (release.status !== 'approved') return { error: 'Release must be approved before publishing.' } as const;
      db.releases.forEach((item) => {
        if (item.appId === release.appId && item.channel === release.channel && item.platform === release.platform && item.status === 'published') {
          item.status = 'archived';
        }
      });
      release.status = 'published';
      release.publishedAt = nowIso();
      return release;
    });
    if (!updated) return res.status(404).json({ error: 'Release not found.' });
    if ('error' in updated) return res.status(409).json(updated);
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.published', targetType: 'release', targetId: req.params.id });
    res.json({ release: updated });
  });

  router.post('/admin/releases/:id/rollback', ...requirePermission(store, 'releases.rollback'), (req: AuthedRequest, res) => {
    const updated = store.update((db) => {
      const release = db.releases.find((r) => r.id === req.params.id);
      if (!release) return null;
      release.status = 'rolled_back';
      release.rolledBackAt = nowIso();
      const candidates = db.releases.filter((item) => item.appId === release.appId && item.channel === release.channel && item.platform === release.platform && item.id !== release.id && ['archived', 'published'].includes(item.status));
      const previous = newestRelease(candidates);
      if (previous) previous.status = 'published';
      return release;
    });
    if (!updated) return res.status(404).json({ error: 'Release not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.rolled_back', targetType: 'release', targetId: req.params.id });
    res.json({ release: updated });
  });

  return router;
}
