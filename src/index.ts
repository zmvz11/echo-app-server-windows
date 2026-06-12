import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { loadEnv } from './config/env.js';
import { JsonStore } from './lib/storage.js';
import { setupRoutes } from './routes/setup.js';
import { authRoutes } from './routes/auth.js';
import { adminUsersRoutes } from './routes/adminUsers.js';
import { appRoutes } from './routes/apps.js';
import { releaseRoutes } from './routes/releases.js';
import { catalogRoutes } from './routes/catalog.js';
import { storeRoutes } from './routes/store.js';
import { serverSettingsRoutes } from './routes/serverSettings.js';
import { clientRoutes } from './routes/clients.js';
import { logRoutes } from './routes/logs.js';
import { startServerCommandConsole } from './cli/serverCommands.js';

const env = loadEnv();
const store = new JsonStore(env.dataDir);
const app = express();
const pidPath = join(env.dataDir, 'echo-app-server.pid');

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin }));
app.use(express.json({ limit: '20mb' }));
app.use('/media', express.static(join(env.dataDir, 'media')));
app.use('/packages', express.static(join(env.dataDir, 'packages')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, product: 'Echo App Server', version: '1.0.0', pid: process.pid });
});

app.use('/api/setup', setupRoutes(store));
app.use('/api/auth', authRoutes(store));
app.use('/api/admin/users', adminUsersRoutes(store));
app.use('/api/apps', appRoutes(store, env));
app.use('/api/releases', releaseRoutes(store, env));
app.use('/api/catalog', catalogRoutes(store));
app.use('/api/store', storeRoutes(store));
app.use('/api/clients', clientRoutes(store));
app.use('/api/logs', logRoutes(store));
app.use('/api/admin/server', serverSettingsRoutes(store, env));

function writePidFile(): void {
  mkdirSync(env.dataDir, { recursive: true });
  writeFileSync(pidPath, String(process.pid), 'utf8');
}

function clearPidFile(): void {
  try {
    if (existsSync(pidPath)) rmSync(pidPath, { force: true });
  } catch {
    // Best effort cleanup only.
  }
}

const server = app.listen(env.port, env.host, () => {
  writePidFile();
  console.log(`Echo App Server listening on http://${env.host}:${env.port}`);
  console.log(`Echo App Center public URL: ${env.publicBaseUrl}`);
  console.log(`PID: ${process.pid}`);
});

function shutdown(): void {
  server.close(() => {
    clearPidFile();
    process.exit(0);
  });
  setTimeout(() => {
    clearPidFile();
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', clearPidFile);

startServerCommandConsole({ store, env, server });
