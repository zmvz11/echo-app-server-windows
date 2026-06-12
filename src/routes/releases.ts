import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonStore } from '../lib/storage.js';
import { makeId, nowIso } from '../lib/id.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/auditLog.js';
import { fetchGitHubRelease } from '../services/githubImport.js';
import type { Env } from '../config/env.js';
import type { AppRelease } from '../types.js';

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

const githubImportSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  tag: z.string().min(1),
  appId: z.string().min(1),
  channel: z.enum(['stable','beta','dev']).default('stable'),
  platform: z.string().min(1).default('windows-x64'),
  entrypoint: z.string().min(1).default(''),
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
      const item = { id: makeId('rel'), appId: req.params.appId, status: 'draft' as const, createdAt: nowIso(), ...parsed.data };
      db.releases.push(item);
      return item;
    });
    if (!release) return res.status(404).json({ error: 'App not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.created', targetType: 'release', targetId: release.id });
    res.status(201).json({ release });
  });

  router.post('/admin/apps/:appId/releases/upload', ...requirePermission(store, 'releases.create'), upload.single('file'), (req: AuthedRequest, res) => {
    if (!req.file) return res.status(400).json({ error: 'Missing package file.' });
    const parsed = releaseSchema.omit({ packageUrl: true, sizeBytes: true }).safeParse({ ...req.body, changelog: String(req.body.changelog ?? '').split('\n').filter(Boolean) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const releaseId = makeId('rel');
    const fileName = `${releaseId}-${safeFileName(req.file.originalname || 'package.zip')}`;
    const targetDir = join(env.dataDir, 'packages', req.params.appId, parsed.data.version, parsed.data.platform);
    mkdirSync(targetDir, { recursive: true });
    renameSync(req.file.path, join(targetDir, fileName));
    const packageUrl = `${env.publicBaseUrl}/packages/${req.params.appId}/${parsed.data.version}/${parsed.data.platform}/${fileName}`;
    const release = store.update((db) => {
      const app = db.apps.find((a) => a.id === req.params.appId);
      if (!app) return null;
      const item = { id: releaseId, appId: req.params.appId, status: 'draft' as const, createdAt: nowIso(), packageUrl, packageFileName: fileName, sizeBytes: req.file?.size, ...parsed.data };
      db.releases.push(item);
      return item;
    });
    if (!release) return res.status(404).json({ error: 'App not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.package.uploaded', targetType: 'release', targetId: release.id });
    res.status(201).json({ release });
  });

  router.post('/admin/releases/import-github', ...requirePermission(store, 'releases.create'), async (req: AuthedRequest, res) => {
    const parsed = githubImportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const info = await fetchGitHubRelease({ owner: parsed.data.owner, repo: parsed.data.repo, tag: parsed.data.tag, token: env.githubToken });
    const asset = info.assets.find((item) => item.name.endsWith('.zip')) ?? info.assets[0];
    if (!asset) return res.status(404).json({ error: 'GitHub release has no downloadable assets.' });
    const release = store.update((db) => {
      const app = db.apps.find((a) => a.id === parsed.data.appId);
      if (!app) return null;
      const item = {
        id: makeId('rel'),
        appId: parsed.data.appId,
        version: parsed.data.tag.replace(/^v/, ''),
        channel: parsed.data.channel,
        platform: parsed.data.platform,
        packageUrl: asset.browser_download_url,
        packageFileName: asset.name,
        sizeBytes: asset.size,
        entrypoint: parsed.data.entrypoint || 'echo-app.json',
        installType: 'portable' as const,
        changelog: info.body.split('\n').filter(Boolean),
        releaseNotes: info.name,
        status: 'draft' as const,
        createdAt: nowIso(),
      };
      db.releases.push(item);
      return item;
    });
    if (!release) return res.status(404).json({ error: 'App not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.release.github.imported', targetType: 'release', targetId: release.id, details: { tag: info.tagName } });
    res.status(201).json({ release });
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
