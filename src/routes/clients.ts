import { Router } from 'express';
import { z } from 'zod';
import type { JsonStore } from '../lib/storage.js';
import { makeId, nowIso } from '../lib/id.js';
import { requirePermission } from '../middleware/auth.js';

const clientSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  platform: z.string().min(1),
  appCenterVersion: z.string().min(1),
  serverUrl: z.string().optional(),
});

const installedSchema = z.object({
  appId: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
  installPath: z.string().min(1),
  status: z.enum(['installed','update_available','broken','removed']).default('installed'),
});

const reportSchema = z.object({
  clientId: z.string().min(1),
  appId: z.string().min(1),
  version: z.string().optional(),
  action: z.enum(['install','update','repair','uninstall','launch']),
  status: z.enum(['started','succeeded','failed']),
  message: z.string().optional(),
});

export function clientRoutes(store: JsonStore): Router {
  const router = Router();

  router.post('/register', (req, res) => {
    const parsed = clientSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const client = store.update((db) => {
      const id = parsed.data.id || makeId('client');
      let item = db.clients.find((c) => c.id === id);
      if (!item) {
        item = { id, installedApps: [], name: parsed.data.name, platform: parsed.data.platform, appCenterVersion: parsed.data.appCenterVersion, serverUrl: parsed.data.serverUrl, lastCheckInAt: nowIso() };
        db.clients.push(item);
      } else {
        Object.assign(item, parsed.data, { lastCheckInAt: nowIso() });
      }
      return item;
    });
    res.json({ client });
  });

  router.post('/:id/check-in', (req, res) => {
    const installed = z.array(installedSchema).default([]).safeParse(req.body.installedApps ?? []);
    if (!installed.success) return res.status(400).json({ error: installed.error.flatten() });
    const client = store.update((db) => {
      const item = db.clients.find((c) => c.id === req.params.id);
      if (!item) return null;
      item.installedApps = installed.data.map((app) => ({ ...app, updatedAt: nowIso() }));
      item.lastCheckInAt = nowIso();
      return item;
    });
    if (!client) return res.status(404).json({ error: 'Client not found.' });
    res.json({ client });
  });

  router.post('/report', (req, res) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const report = store.update((db) => {
      const item = { id: makeId('report'), createdAt: nowIso(), ...parsed.data };
      db.installReports.unshift(item);
      db.installReports = db.installReports.slice(0, 5000);
      return item;
    });
    res.status(201).json({ report });
  });

  router.get('/admin', ...requirePermission(store, 'logs.view'), (_req, res) => {
    const db = store.read();
    res.json({ clients: db.clients, installReports: db.installReports.slice(0, 250) });
  });

  return router;
}
