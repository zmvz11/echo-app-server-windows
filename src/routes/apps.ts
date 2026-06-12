import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdirSync, renameSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { JsonStore } from '../lib/storage.js';
import { makeId, nowIso } from '../lib/id.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/auditLog.js';
import type { Env } from '../config/env.js';

const appSchema = z.object({
  id: z.string().min(2).regex(/^[a-z0-9_-]+$/), name: z.string().min(1), shortDescription: z.string().default(''), fullDescription: z.string().default(''), developer: z.string().default('Echo Apps'), category: z.string().default('Utility'), tags: z.array(z.string()).default([]), platforms: z.array(z.string()).default(['windows-x64', 'linux-x64']), visibility: z.enum(['draft','published','hidden','archived']).default('draft'), featured: z.boolean().default(false),
});
const mediaSchema = z.object({ type: z.enum(['icon','library_banner','store_banner','store_hero','card_thumbnail','screenshot','thumbnail']), url: z.string().min(1), sortOrder: z.coerce.number().int().default(0) });
const upload = multer({ dest: './data/tmp', limits: { fileSize: 50 * 1024 * 1024 } });
function safeFileName(name: string): string { return name.replace(/[^a-zA-Z0-9._-]/g, '-'); }
function assertImage(file: Express.Multer.File): void { if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) throw new Error('Only PNG, JPG, and WEBP media files are allowed.'); }

export function appRoutes(store: JsonStore, env: Env): Router {
  const router = Router();
  router.get('/', (_req, res) => { const db = store.read(); res.json({ apps: db.apps.filter((app) => app.visibility === 'published') }); });
  router.get('/admin/all', ...requirePermission(store, 'apps.edit'), (_req, res) => { const db = store.read(); res.json({ apps: db.apps }); });
  router.get('/:id', requireAuth(store), (req, res) => { const db = store.read(); const app = db.apps.find((a) => a.id === req.params.id && a.visibility !== 'archived'); if (!app) return res.status(404).json({ error: 'App not found.' }); res.json({ app }); });
  router.post('/admin/create', ...requirePermission(store, 'apps.create'), (req: AuthedRequest, res) => {
    const parsed = appSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = store.update((db) => { if (db.apps.some((a) => a.id === parsed.data.id)) return { error: 'App ID already exists.' }; const app = { ...parsed.data, media: [], createdAt: nowIso(), updatedAt: nowIso() }; db.apps.push(app); return { app }; });
    if ('error' in result) return res.status(409).json(result); writeAudit(store, { actorUserId: req.user?.id, action: 'admin.app.created', targetType: 'app', targetId: result.app.id }); res.status(201).json(result);
  });
  router.patch('/admin/:id', ...requirePermission(store, 'apps.edit'), (req: AuthedRequest, res) => {
    const partial = appSchema.partial().safeParse(req.body); if (!partial.success) return res.status(400).json({ error: partial.error.flatten() });
    const updated = store.update((db) => { const app = db.apps.find((a) => a.id === req.params.id); if (!app) return null; Object.assign(app, partial.data, { updatedAt: nowIso() }); return app; });
    if (!updated) return res.status(404).json({ error: 'App not found.' }); writeAudit(store, { actorUserId: req.user?.id, action: 'admin.app.updated', targetType: 'app', targetId: req.params.id }); res.json({ app: updated });
  });
  router.patch('/admin/:id/featured', ...requirePermission(store, 'apps.edit'), (req: AuthedRequest, res) => {
    const parsed = z.object({ featured: z.boolean() }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const app = store.update((db) => { const item = db.apps.find((a) => a.id === req.params.id); if (!item) return null; item.featured = parsed.data.featured; item.updatedAt = nowIso(); return item; });
    if (!app) return res.status(404).json({ error: 'App not found.' }); writeAudit(store, { actorUserId: req.user?.id, action: 'admin.app.featured.updated', targetType: 'app', targetId: req.params.id }); res.json({ app });
  });
  router.patch('/admin/:id/visibility', ...requirePermission(store, 'apps.edit'), (req: AuthedRequest, res) => {
    const parsed = z.object({ visibility: z.enum(['draft','published','hidden','archived']) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const app = store.update((db) => { const item = db.apps.find((a) => a.id === req.params.id); if (!item) return null; item.visibility = parsed.data.visibility; item.updatedAt = nowIso(); return item; });
    if (!app) return res.status(404).json({ error: 'App not found.' }); writeAudit(store, { actorUserId: req.user?.id, action: 'admin.app.visibility.updated', targetType: 'app', targetId: req.params.id, details: { visibility: parsed.data.visibility } }); res.json({ app });
  });
  router.delete('/admin/:id', ...requirePermission(store, 'apps.delete'), (req: AuthedRequest, res) => { const updated = store.update((db) => { const app = db.apps.find((a) => a.id === req.params.id); if (!app) return null; app.visibility = 'archived'; app.updatedAt = nowIso(); return app; }); if (!updated) return res.status(404).json({ error: 'App not found.' }); writeAudit(store, { actorUserId: req.user?.id, action: 'admin.app.archived', targetType: 'app', targetId: req.params.id }); res.json({ app: updated }); });
  router.post('/admin/:id/media', ...requirePermission(store, 'media.upload'), (req: AuthedRequest, res) => { const parsed = mediaSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() }); const media = store.update((db) => { const app = db.apps.find((a) => a.id === req.params.id); if (!app) return null; const item = { id: makeId('media'), ...parsed.data, createdAt: nowIso() }; app.media.push(item); app.updatedAt = nowIso(); return item; }); if (!media) return res.status(404).json({ error: 'App not found.' }); writeAudit(store, { actorUserId: req.user?.id, action: 'admin.app.media.added', targetType: 'app', targetId: req.params.id }); res.status(201).json({ media }); });
  router.post('/admin/:id/media/upload', ...requirePermission(store, 'media.upload'), upload.single('file'), (req: AuthedRequest, res) => { try { if (!req.file) return res.status(400).json({ error: 'Missing media file.' }); assertImage(req.file); const parsed = mediaSchema.omit({ url: true }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() }); const id = makeId('media'); const extension = extname(req.file.originalname) || '.png'; const fileName = `${id}-${safeFileName(req.file.originalname || `media${extension}`)}`; const relativePath = `/media/${req.params.id}/${fileName}`; const targetDir = join(env.dataDir, 'media', req.params.id); mkdirSync(targetDir, { recursive: true }); renameSync(req.file.path, join(targetDir, fileName)); const url = `${env.publicBaseUrl}${relativePath}`; const media = store.update((db) => { const app = db.apps.find((a) => a.id === req.params.id); if (!app) return null; const item = { id, ...parsed.data, url, fileName, sizeBytes: req.file?.size, createdAt: nowIso() }; app.media.push(item); app.updatedAt = nowIso(); return item; }); if (!media) return res.status(404).json({ error: 'App not found.' }); writeAudit(store, { actorUserId: req.user?.id, action: 'admin.app.media.uploaded', targetType: 'app', targetId: req.params.id }); res.status(201).json({ media }); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Upload failed.' }); } });
  return router;
}
