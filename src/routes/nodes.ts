import { Router, type Request, type RequestHandler } from 'express';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { JsonStore } from '../lib/storage.js';
import { makeId, nowIso } from '../lib/id.js';
import { requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/auditLog.js';
import type { DownloadLocation, EchoNode, NodePermissionKey, NodePermissions, NodeRole } from '../types.js';

const permissionKeys: NodePermissionKey[] = ['canPullPackages', 'canPullMedia', 'canServeDownloads', 'canPullDatabaseBackup', 'canBePromoted', 'canRunAdminApi'];
const roleSchema = z.enum(['primary', 'download_mirror', 'standby_backup', 'full_backup']);

const joinRequestSchema = z.object({
  nickname: z.string().min(1).max(80),
  nodeType: roleSchema.default('download_mirror'),
  baseUrl: z.string().url(),
  fingerprint: z.string().min(8).max(128),
  requestedPermissions: z.array(z.enum(permissionKeys as [NodePermissionKey, ...NodePermissionKey[]])).optional(),
});

const approveSchema = z.object({
  permissions: z.object({
    canPullPackages: z.boolean().default(false),
    canPullMedia: z.boolean().default(false),
    canServeDownloads: z.boolean().default(false),
    canPullDatabaseBackup: z.boolean().default(false),
    canBePromoted: z.boolean().default(false),
    canRunAdminApi: z.boolean().default(false),
  }).partial().optional(),
});

const rejectSchema = z.object({ reason: z.string().optional() });
const syncSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  requireApproval: z.boolean().default(true),
  intervalMinutes: z.coerce.number().int().min(1).max(1440).default(15),
  allowDownloadMirrors: z.boolean().default(true),
  allowStandbyBackups: z.boolean().default(true),
});

function defaultPermissions(role: NodeRole): NodePermissions {
  if (role === 'download_mirror') return { canPullPackages: true, canPullMedia: true, canServeDownloads: true, canPullDatabaseBackup: false, canBePromoted: false, canRunAdminApi: false };
  if (role === 'standby_backup') return { canPullPackages: true, canPullMedia: true, canServeDownloads: true, canPullDatabaseBackup: true, canBePromoted: true, canRunAdminApi: false };
  if (role === 'full_backup') return { canPullPackages: true, canPullMedia: true, canServeDownloads: true, canPullDatabaseBackup: true, canBePromoted: true, canRunAdminApi: false };
  return { canPullPackages: false, canPullMedia: false, canServeDownloads: false, canPullDatabaseBackup: false, canBePromoted: false, canRunAdminApi: false };
}

function mergePermissions(role: NodeRole, overrides?: Partial<NodePermissions>): NodePermissions {
  return { ...defaultPermissions(role), ...(overrides ?? {}) };
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

async function pingNode(url: string): Promise<{ online: boolean; pingMs?: number; detail: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${normalizeBaseUrl(url)}/health`, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { online: response.ok, pingMs: Date.now() - started, detail: response.ok ? `${data.product ?? 'Node'} responded` : `HTTP ${response.status}` };
  } catch (error) {
    return { online: false, detail: error instanceof Error ? error.message : 'Node did not respond.' };
  } finally {
    clearTimeout(timer);
  }
}

function nodeAuth(store: JsonStore): RequestHandler {
  return (req, res, next) => {
    const token = req.header('x-echo-node-token') || (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Node token required.' });
    const node = store.read().nodes.find((item) => item.token === token && item.status === 'approved');
    if (!node) return res.status(403).json({ error: 'Node token is invalid or disabled.' });
    (req as Request & { echoNode?: EchoNode }).echoNode = node;
    next();
  };
}

function listFiles(baseDir: string, publicPrefix: string, publicBaseUrl: string): Array<{ path: string; url: string; sizeBytes: number; modifiedAt: string }> {
  const results: Array<{ path: string; url: string; sizeBytes: number; modifiedAt: string }> = [];
  function walk(dir: string): void {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else {
        const rel = relative(baseDir, full).split('\\').join('/');
        results.push({ path: rel, url: `${publicBaseUrl}${publicPrefix}/${rel}`, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() });
      }
    }
  }
  walk(baseDir);
  return results;
}

function downloadLocations(store: JsonStore, env: Env): DownloadLocation[] {
  const db = store.read();
  return [
    { id: 'primary', nickname: 'Main Server', nodeType: 'primary', baseUrl: env.publicBaseUrl, status: 'online', isPrimary: true },
    ...db.nodes.filter((node) => node.status === 'approved' && node.permissions.canServeDownloads).map((node) => ({ id: node.id, nickname: node.nickname, nodeType: node.nodeType, baseUrl: node.baseUrl, status: node.lastSeenAt ? 'online' as const : 'unknown' as const, lastSyncAt: node.lastSyncAt, storageFreeBytes: node.storageFreeBytes })),
  ];
}

export function nodeRoutes(store: JsonStore, env: Env): Router {
  const router = Router();

  router.post('/nodes/join-request', (req, res) => {
    const parsed = joinRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;
    const request = store.update((db) => {
      const existingPending = db.nodeRequests.find((item) => item.status === 'pending' && item.fingerprint === data.fingerprint);
      if (existingPending) {
        existingPending.nickname = data.nickname;
        existingPending.nodeType = data.nodeType;
        existingPending.baseUrl = normalizeBaseUrl(data.baseUrl);
        existingPending.requestedPermissions = data.requestedPermissions ?? permissionKeys.filter((key) => defaultPermissions(data.nodeType)[key]);
        return existingPending;
      }
      const item = { id: makeId('node_req'), nickname: data.nickname, nodeType: data.nodeType, baseUrl: normalizeBaseUrl(data.baseUrl), fingerprint: data.fingerprint, requestedPermissions: data.requestedPermissions ?? permissionKeys.filter((key) => defaultPermissions(data.nodeType)[key]), status: 'pending' as const, createdAt: nowIso() };
      db.nodeRequests.unshift(item);
      return item;
    });
    res.status(202).json({ status: request.status, requestId: request.id, message: 'Join request received. Approve this node in Echo App Center Settings → Server Nodes.' });
  });

  router.get('/nodes/join-request/:id/status', (req, res) => {
    const fingerprint = String(req.query.fingerprint ?? '');
    const request = store.read().nodeRequests.find((item) => item.id === req.params.id && (!fingerprint || item.fingerprint === fingerprint));
    if (!request) return res.status(404).json({ error: 'Join request not found.' });
    res.json({ status: request.status, requestId: request.id, nodeId: request.nodeId, token: request.status === 'approved' ? request.token : undefined, rejectionReason: request.rejectionReason });
  });

  router.get('/nodes/download-locations', (_req, res) => res.json({ locations: downloadLocations(store, env) }));

  router.get('/nodes/sync/manifest', nodeAuth(store), (req, res) => {
    const node = (req as Request & { echoNode: EchoNode }).echoNode;
    const packages = node.permissions.canPullPackages ? listFiles(join(env.dataDir, 'packages'), '/packages', env.publicBaseUrl) : [];
    const media = node.permissions.canPullMedia ? listFiles(join(env.dataDir, 'media'), '/media', env.publicBaseUrl) : [];
    res.json({ manifest: { generatedAt: nowIso(), nodeId: node.id, packages, media } });
  });

  router.post('/nodes/sync/check-in', nodeAuth(store), (req, res) => {
    const node = (req as Request & { echoNode: EchoNode }).echoNode;
    const updated = store.update((db) => {
      const item = db.nodes.find((candidate) => candidate.id === node.id);
      if (!item) return null;
      item.lastSeenAt = nowIso();
      item.lastSyncAt = String(req.body.lastSyncAt ?? item.lastSyncAt ?? nowIso());
      item.packagesSynced = Number(req.body.packagesSynced ?? item.packagesSynced ?? 0);
      item.mediaSynced = Number(req.body.mediaSynced ?? item.mediaSynced ?? 0);
      item.storageFreeBytes = Number(req.body.storageFreeBytes ?? item.storageFreeBytes ?? 0);
      item.healthMessage = String(req.body.healthMessage ?? 'Node checked in.');
      return item;
    });
    res.json({ ok: true, node: updated });
  });

  router.get('/admin/nodes', ...requirePermission(store, 'server.settings.edit'), (_req, res) => {
    const db = store.read();
    res.json({ nodes: db.nodes, requests: db.nodeRequests.filter((item) => item.status === 'pending'), syncSettings: db.syncSettings });
  });

  router.get('/admin/nodes/requests', ...requirePermission(store, 'server.settings.edit'), (_req, res) => {
    res.json({ requests: store.read().nodeRequests.filter((item) => item.status === 'pending') });
  });

  router.post('/admin/nodes/requests/:id/approve', ...requirePermission(store, 'server.settings.edit'), (req: AuthedRequest, res) => {
    const parsed = approveSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = store.update((db) => {
      const request = db.nodeRequests.find((item) => item.id === req.params.id);
      if (!request) return null;
      const token = makeId('node_token');
      const node: EchoNode = { id: makeId('node'), nickname: request.nickname, nodeType: request.nodeType, baseUrl: request.baseUrl, fingerprint: request.fingerprint, token, status: 'approved', permissions: mergePermissions(request.nodeType, parsed.data.permissions), createdAt: nowIso(), approvedAt: nowIso(), approvedBy: req.user?.id, healthMessage: 'Approved. Waiting for first check-in.' };
      request.status = 'approved';
      request.reviewedAt = nowIso();
      request.reviewedBy = req.user?.id;
      request.nodeId = node.id;
      request.token = token;
      db.nodes = db.nodes.filter((item) => item.fingerprint !== node.fingerprint);
      db.nodes.unshift(node);
      return { request, node };
    });
    if (!result) return res.status(404).json({ error: 'Node request not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.node.approved', targetType: 'node', targetId: result.node.id, details: { nickname: result.node.nickname, permissions: result.node.permissions } });
    res.json(result);
  });

  router.post('/admin/nodes/requests/:id/reject', ...requirePermission(store, 'server.settings.edit'), (req: AuthedRequest, res) => {
    const parsed = rejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const request = store.update((db) => {
      const item = db.nodeRequests.find((candidate) => candidate.id === req.params.id);
      if (!item) return null;
      item.status = 'rejected';
      item.reviewedAt = nowIso();
      item.reviewedBy = req.user?.id;
      item.rejectionReason = parsed.data.reason ?? 'Rejected by admin.';
      return item;
    });
    if (!request) return res.status(404).json({ error: 'Node request not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.node.rejected', targetType: 'node_request', targetId: request.id, details: { nickname: request.nickname } });
    res.json({ request });
  });

  router.patch('/admin/nodes/:id/permissions', ...requirePermission(store, 'server.settings.edit'), (req: AuthedRequest, res) => {
    const parsed = approveSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const node = store.update((db) => {
      const item = db.nodes.find((candidate) => candidate.id === req.params.id);
      if (!item) return null;
      item.permissions = mergePermissions(item.nodeType, { ...item.permissions, ...(parsed.data.permissions ?? {}) });
      return item;
    });
    if (!node) return res.status(404).json({ error: 'Node not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.node.permissions.updated', targetType: 'node', targetId: node.id });
    res.json({ node });
  });

  router.post('/admin/nodes/:id/test', ...requirePermission(store, 'server.settings.edit'), async (req, res) => {
    const node = store.read().nodes.find((item) => item.id === req.params.id);
    if (!node) return res.status(404).json({ error: 'Node not found.' });
    const health = await pingNode(node.baseUrl);
    const updated = store.update((db) => {
      const item = db.nodes.find((candidate) => candidate.id === node.id);
      if (!item) return null;
      item.lastSeenAt = health.online ? nowIso() : item.lastSeenAt;
      item.healthMessage = health.detail;
      if (!health.online && item.status === 'approved') item.status = 'offline';
      if (health.online && item.status === 'offline') item.status = 'approved';
      return item;
    });
    res.json({ node: updated, health });
  });

  router.post('/admin/nodes/:id/sync-now', ...requirePermission(store, 'server.settings.edit'), (req: AuthedRequest, res) => {
    const node = store.update((db) => {
      const item = db.nodes.find((candidate) => candidate.id === req.params.id);
      if (!item) return null;
      item.lastSyncAt = nowIso();
      item.healthMessage = 'Manual sync requested by admin. Node may pull package/media manifest on next check-in.';
      return item;
    });
    if (!node) return res.status(404).json({ error: 'Node not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.node.sync.requested', targetType: 'node', targetId: node.id });
    res.json({ node });
  });

  router.delete('/admin/nodes/:id', ...requirePermission(store, 'server.settings.edit'), (req: AuthedRequest, res) => {
    const removed = store.update((db) => {
      const node = db.nodes.find((item) => item.id === req.params.id);
      db.nodes = db.nodes.filter((item) => item.id !== req.params.id);
      return node;
    });
    if (!removed) return res.status(404).json({ error: 'Node not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.node.removed', targetType: 'node', targetId: removed.id });
    res.json({ ok: true });
  });

  router.get('/admin/sync/status', ...requirePermission(store, 'server.settings.edit'), (_req, res) => {
    const db = store.read();
    res.json({ syncSettings: db.syncSettings, nodes: db.nodes, pendingRequests: db.nodeRequests.filter((item) => item.status === 'pending') });
  });

  router.post('/admin/sync/setup', ...requirePermission(store, 'server.settings.edit'), (req: AuthedRequest, res) => {
    const parsed = syncSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const syncSettings = store.update((db) => {
      db.syncSettings = { ...parsed.data, lastConfiguredAt: nowIso() };
      return db.syncSettings;
    });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.sync.configured', targetType: 'sync_settings' });
    res.json({ syncSettings });
  });

  router.post('/admin/sync/run', ...requirePermission(store, 'server.settings.edit'), (req: AuthedRequest, res) => {
    const nodes = store.update((db) => {
      for (const node of db.nodes) {
        if (node.status === 'approved') {
          node.lastSyncAt = nowIso();
          node.healthMessage = 'Manual sync cycle requested from primary.';
        }
      }
      return db.nodes;
    });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.sync.run', targetType: 'sync' });
    res.json({ nodes });
  });

  router.get('/releases/:releaseId/download-options', (req, res) => {
    const db = store.read();
    const release = db.releases.find((item) => item.id === req.params.releaseId);
    if (!release) return res.status(404).json({ error: 'Release not found.' });
    res.json({ releaseId: release.id, recommended: 'primary', locations: downloadLocations(store, env) });
  });

  return router;
}
