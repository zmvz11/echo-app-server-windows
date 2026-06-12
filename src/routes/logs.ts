import { Router } from 'express';
import type { JsonStore } from '../lib/storage.js';
import { requirePermission } from '../middleware/auth.js';

export function logRoutes(store: JsonStore): Router {
  const router = Router();

  router.get('/admin', ...requirePermission(store, 'logs.view'), (_req, res) => {
    const db = store.read();
    res.json({ logs: db.auditLogs.slice(0, 500) });
  });

  return router;
}
