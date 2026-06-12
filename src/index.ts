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
import { nodeRoutes } from './routes/nodes.js';
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
  res.json({ ok: true, product: 'Echo App Server', version: '1.5.0', pid: process.pid });
});

app.get(['/admin', '/dashboard'], (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Echo App Server</title>
  <style>
    body { margin: 0; font-family: Inter, Segoe UI, Arial, sans-serif; background: #080b12; color: #e5eefc; }
    main { max-width: 980px; margin: 0 auto; padding: 48px 24px; }
    .panel { border: 1px solid rgba(118, 164, 255, .24); background: linear-gradient(135deg, rgba(18,26,43,.92), rgba(10,14,24,.92)); border-radius: 22px; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
    h1 { margin: 0 0 8px; font-size: 34px; }
    p { color: #aebdd3; line-height: 1.6; }
    code { background: rgba(255,255,255,.08); padding: 3px 7px; border-radius: 7px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 22px; }
    a { color: #8ab4ff; text-decoration: none; }
    .card { padding: 16px; border-radius: 14px; background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.08); }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1>Echo App Server</h1>
      <p>The server is online. Use Echo App Center for the full Store, Library, and Admin Portal experience.</p>
      <div class="grid">
        <div class="card"><strong>Health</strong><br/><a href="/health">/health</a></div>
        <div class="card"><strong>Store API</strong><br/><a href="/api/store/apps">/api/store/apps</a></div>
        <div class="card"><strong>Setup Status</strong><br/><a href="/api/setup/status">/api/setup/status</a></div>
        <div class="card"><strong>CLI</strong><br/><code>echo-server doctor</code></div>
      </div>
    </section>
  </main>
</body>
</html>`);
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
app.use('/api', nodeRoutes(store, env));

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
