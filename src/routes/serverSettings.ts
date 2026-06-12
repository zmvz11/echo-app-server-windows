import { Router } from 'express';
import type { Env } from '../config/env.js';
import type { JsonStore } from '../lib/storage.js';
import { requirePermission } from '../middleware/auth.js';

export function serverSettingsRoutes(store: JsonStore, env: Env): Router {
  const router = Router();

  router.get('/settings', ...requirePermission(store, 'server.settings.edit'), (_req, res) => {
    res.json({
      settings: {
        host: env.host,
        port: env.port,
        publicBaseUrl: env.publicBaseUrl,
        dataDir: env.dataDir,
        note: 'Port and host changes are made in the server .env file and require restarting Echo App Server.',
      },
    });
  });

  return router;
}
