#!/usr/bin/env node
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { runUpdateCommand } from './update.js';
import { runServiceCommand, serviceDoctorSummary } from './service.js';
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import { hashPassword } from '../auth/passwordHash.js';
import { validatePassword } from '../auth/passwordPolicy.js';
import { normalizeUsername, validateUsername } from '../auth/usernameRules.js';
import { makeId, nowIso } from '../lib/id.js';
import { JsonStore } from '../lib/storage.js';
import type { Database, UserRole, UserStatus } from '../types.js';

const ENV_PATH = resolve(process.cwd(), '.env');
const roles: UserRole[] = ['owner', 'admin', 'app_manager', 'reviewer', 'user'];

type EnvConfig = {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  publicHost: string;
  publicBaseUrl: string;
  dataDir: string;
  corsOrigin: string;
  githubToken: string;
};

type SetupFlags = Record<string, string | boolean>;
type CheckLevel = 'PASS' | 'WARN' | 'FAIL';
type CheckResult = { level: CheckLevel; name: string; detail?: string };

function banner(): void {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    Echo App Server                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
}

function printHelp(): void {
  banner();
  console.log(`
Usage:
  echo-server                                      Open command-center mode
  echo-server onboard                             Run first-run onboarding
  echo-server setup                               Run guided setup wizard
  echo-server start                               Start server in this terminal
  echo-server stop                                Stop a running server started by Echo
  echo-server restart                             Stop, then start server in this terminal
  echo-server status                              Show config, server health, and counts
  echo-server doctor                              Run setup/config/network diagnostics
  echo-server dashboard                           Open/show server dashboard URL
  echo-server install-info                        Show GitHub one-line install/update source
  echo-server service <install|start|stop|status> Manage background service/logon task
  echo-server update --check                      Check GitHub Releases for updates
  echo-server update --dry-run                    Preview update actions
  echo-server update                              Back up, download, apply, build, restart, doctor
  echo-server update --rollback                   Restore latest updater backup
  echo-server config show                         Show current server config
  echo-server config set <key> <value>            Set config value
  echo-server node setup                          Request to join a primary as a node
  echo-server node status                         Show local node approval/sync status
  echo-server node doctor                         Check local node configuration
  echo-server node promote                        Promote standby/full backup to primary mode
  echo-server sync setup                          Enable primary sync/node approval mode
  echo-server sync status                         Show sync and node status
  echo-server sync nodes                          List approved nodes
  echo-server sync requests                       List pending node requests
  echo-server sync approve <request-id>           Approve a pending node request
  echo-server sync reject <request-id>            Reject a pending node request
  echo-server sync now                            Mark a manual sync cycle
  echo-server url                                 Show App Center connection URL
  echo-server users [pending]                     List users
  echo-server approve <username>                  Approve pending user
  echo-server reject <username>                   Reject user
  echo-server disable <username>                  Disable user and clear sessions
  echo-server role <username> <role>              Set role: ${roles.join('|')}
  echo-server apps                                List apps
  echo-server releases                            List releases
  echo-server clients                             List App Center clients
  echo-server logs [count]                        Show latest audit logs
  echo-server help                                Show this help

Config keys:
  host, port, public-url, data-dir, cors, github-token
  update.repo, update.channel, update.asset

Runtime slash commands:
  After starting the server, type /help in that server terminal.

Notes:
  Use echo-server, not echo. On Windows, echo is a built-in shell command.
  The updater pulls from GitHub Releases. Create release assets before using echo-server update.
`);
}

function parseArgs(inputLine: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(inputLine)) !== null) args.push(match[1] ?? match[2] ?? match[3] ?? '');
  return args;
}

function readEnvFile(path = ENV_PATH): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;
  const text = readFileSync(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

function writeEnvFile(values: Map<string, string>, path = ENV_PATH): void {
  const ordered = [
    'ECHO_SERVER_HOST',
    'ECHO_SERVER_PORT',
    'ECHO_PUBLIC_BASE_URL',
    'ECHO_DATA_DIR',
    'ECHO_CORS_ORIGIN',
    'ECHO_GITHUB_TOKEN',
    'ECHO_UPDATE_REPO',
    'ECHO_UPDATE_CHANNEL',
    'ECHO_UPDATE_ASSET_PATTERN',
  ];
  const lines = [
    '# Echo App Server configuration',
    '# Generated by echo-server setup',
  ];
  for (const key of ordered) {
    if (values.has(key)) lines.push(`${key}=${values.get(key) ?? ''}`);
  }
  for (const [key, value] of values.entries()) {
    if (!ordered.includes(key)) lines.push(`${key}=${value}`);
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

function parsePublicUrl(publicBaseUrl: string, fallbackPort: number): { protocol: 'http' | 'https'; publicHost: string } {
  try {
    const url = new URL(publicBaseUrl);
    const protocol = url.protocol.replace(':', '') === 'https' ? 'https' : 'http';
    return { protocol, publicHost: url.hostname || '127.0.0.1' };
  } catch {
    return { protocol: 'http', publicHost: `127.0.0.1` };
  }
}

function loadConfig(): EnvConfig {
  const env = readEnvFile();
  const host = env.get('ECHO_SERVER_HOST') || '0.0.0.0';
  const portText = env.get('ECHO_SERVER_PORT') || '8080';
  const port = Number.parseInt(portText, 10) || 8080;
  const publicBaseUrl = (env.get('ECHO_PUBLIC_BASE_URL') || `http://127.0.0.1:${port}`).replace(/\/$/, '');
  const parsed = parsePublicUrl(publicBaseUrl, port);
  return {
    host,
    port,
    protocol: parsed.protocol,
    publicHost: parsed.publicHost,
    publicBaseUrl,
    dataDir: env.get('ECHO_DATA_DIR') || './data',
    corsOrigin: env.get('ECHO_CORS_ORIGIN') || '*',
    githubToken: env.get('ECHO_GITHUB_TOKEN') || '',
  };
}

function saveConfig(config: EnvConfig): void {
  const existing = readEnvFile();
  existing.set('ECHO_SERVER_HOST', config.host);
  existing.set('ECHO_SERVER_PORT', String(config.port));
  existing.set('ECHO_PUBLIC_BASE_URL', config.publicBaseUrl);
  existing.set('ECHO_DATA_DIR', config.dataDir);
  existing.set('ECHO_CORS_ORIGIN', config.corsOrigin);
  existing.set('ECHO_GITHUB_TOKEN', config.githubToken);
  writeEnvFile(existing);
}

function absoluteDataDir(dataDir: string): string {
  return resolve(process.cwd(), dataDir);
}

function getStore(config = loadConfig()): JsonStore {
  return new JsonStore(absoluteDataDir(config.dataDir));
}

function getPidPath(config = loadConfig()): string {
  return join(absoluteDataDir(config.dataDir), 'echo-app-server.pid');
}

function readPid(config = loadConfig()): number | undefined {
  const pidPath = getPidPath(config);
  if (!existsSync(pidPath)) return undefined;
  const raw = readFileSync(pidPath, 'utf8').trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseFlags(args: string[]): SetupFlags {
  const flags: SetupFlags = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    const next = args[index + 1];
    if (!next || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

function flagString(flags: SetupFlags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function flagNumber(flags: SetupFlags, key: string): number | undefined {
  const value = flagString(flags, key);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

async function questionWithDefault(rl: readline.Interface, prompt: string, defaultValue: string): Promise<string> {
  const value = await rl.question(`${prompt} [${defaultValue}]: `);
  const trimmed = value.trim();
  return trimmed ? trimmed : defaultValue;
}

async function yesNo(rl: readline.Interface, prompt: string, defaultYes: boolean): Promise<boolean> {
  const label = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${prompt} [${label}]: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function promptPort(rl: readline.Interface, defaultPort: number): Promise<number> {
  while (true) {
    const raw = await questionWithDefault(rl, 'Server port', String(defaultPort));
    const port = Number.parseInt(raw, 10);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
    console.log('Enter a valid TCP port from 1 to 65535.');
  }
}

async function promptHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    const value = await rl.question(prompt);
    rl.close();
    return value;
  }

  return new Promise((resolveValue) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';
    const wasRaw = Boolean(stdin.isRaw);

    stdout.write(prompt);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw);
      stdout.write('\n');
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          process.exit(130);
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolveValue(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        value += char;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

async function promptOwnerPassword(): Promise<string> {
  while (true) {
    const password = await promptHidden('Owner password: ');
    const passwordError = validatePassword(password);
    if (passwordError) {
      console.log(passwordError);
      continue;
    }
    const confirm = await promptHidden('Confirm owner password: ');
    if (password !== confirm) {
      console.log('Passwords did not match. Try again.');
      continue;
    }
    return password;
  }
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  const listenHost = host === '0.0.0.0' ? '0.0.0.0' : host;
  return new Promise((resolveAvailable) => {
    const probe = createServer();
    probe.once('error', () => resolveAvailable(false));
    probe.once('listening', () => {
      probe.close(() => resolveAvailable(true));
    });
    probe.listen(port, listenHost);
  });
}

async function fetchHealth(config: EnvConfig, timeoutMs = 1500): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.publicBaseUrl}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const data = await response.json() as { ok?: boolean; product?: string };
    return { ok: data.ok === true, detail: data.product || 'health endpoint responded' };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function createOwnerDirect(config: EnvConfig, usernameInput: string, password: string, displayName?: string): void {
  const username = normalizeUsername(usernameInput);
  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);

  mkdirSync(absoluteDataDir(config.dataDir), { recursive: true });
  const store = new JsonStore(absoluteDataDir(config.dataDir));
  const now = nowIso();
  const result = store.update((nextDb) => {
    if (nextDb.users.some((item) => item.role === 'owner')) return 'exists' as const;
    const user = {
      id: makeId('user'),
      username,
      displayName: displayName || username,
      passwordHash: hashPassword(password),
      status: 'approved' as const,
      role: 'owner' as const,
      createdAt: now,
      approvedAt: now,
    };
    nextDb.users.push(user);
    nextDb.auditLogs.unshift({
      id: makeId('audit'),
      actorUserId: user.id,
      action: 'setup.owner.created.cli',
      targetType: 'user',
      targetId: user.id,
      createdAt: nowIso(),
    });
    return 'created' as const;
  });
  if (result === 'exists') console.log('Owner account already exists. Skipped owner creation.');
  else console.log(`Created Owner account: ${username}`);
}

async function createOwnerIfNeeded(config: EnvConfig, rl: readline.Interface): Promise<void> {
  mkdirSync(absoluteDataDir(config.dataDir), { recursive: true });
  const store = new JsonStore(absoluteDataDir(config.dataDir));
  const db = store.read();
  const existingOwners = db.users.filter((user) => user.role === 'owner');
  if (existingOwners.length > 0) {
    console.log(`Owner account already exists: ${existingOwners.map((u) => u.username).join(', ')}`);
    return;
  }

  const createNow = await yesNo(rl, 'Create first Owner/admin account now?', true);
  if (!createNow) {
    console.log('Skipped owner creation. Echo App Center can create the first owner after connecting.');
    return;
  }

  let username = '';
  while (true) {
    username = normalizeUsername(await questionWithDefault(rl, 'Owner username', 'admin'));
    const error = validateUsername(username);
    if (!error) break;
    console.log(error);
  }

  const displayName = await questionWithDefault(rl, 'Owner display name', username);
  const password = await promptOwnerPassword();
  createOwnerDirect(config, username, password, displayName);
}

async function runSetupWizard(): Promise<void> {
  const existing = loadConfig();
  const rl = readline.createInterface({ input, output });

  try {
    banner();
    console.log('Guided setup wizard');
    console.log('Press Enter to keep the value in brackets.\n');

    const allowLan = await yesNo(rl, 'Allow App Centers on other computers to connect over LAN?', existing.host === '0.0.0.0');
    const defaultHost = allowLan ? '0.0.0.0' : '127.0.0.1';
    const host = await questionWithDefault(rl, 'Bind host', existing.host || defaultHost);
    const port = await promptPort(rl, existing.port);
    let protocol = await questionWithDefault(rl, 'Public protocol for App Center clients', existing.protocol);
    protocol = protocol.toLowerCase() === 'https' ? 'https' : 'http';
    const publicHostDefault = allowLan ? existing.publicHost : '127.0.0.1';
    const publicHost = await questionWithDefault(rl, 'Server IP/hostname App Centers will use', publicHostDefault);
    const dataDir = await questionWithDefault(rl, 'Data directory', existing.dataDir);
    const corsDefault = allowLan ? '*' : existing.corsOrigin;
    const corsOrigin = await questionWithDefault(rl, 'Allowed App Center origin/CORS', corsDefault);
    const publicBaseUrl = `${protocol}://${publicHost}:${port}`;
    const githubToken = existing.githubToken;
    const config: EnvConfig = { host, port, protocol: protocol as 'http' | 'https', publicHost, publicBaseUrl, dataDir, corsOrigin, githubToken };

    console.log('\nConfiguration preview');
    console.log(`  Server bind:         ${host}:${port}`);
    console.log(`  App Center URL:      ${publicBaseUrl}`);
    console.log(`  Data directory:      ${absoluteDataDir(dataDir)}`);
    console.log(`  CORS:                ${corsOrigin}`);

    const save = await yesNo(rl, 'Save this setup?', true);
    if (!save) {
      console.log('Setup cancelled. No changes saved.');
      return;
    }

    saveConfig(config);
    mkdirSync(absoluteDataDir(dataDir), { recursive: true });
    mkdirSync(join(absoluteDataDir(dataDir), 'media'), { recursive: true });
    mkdirSync(join(absoluteDataDir(dataDir), 'packages'), { recursive: true });

    const available = await isPortAvailable(host, port);
    if (!available) {
      console.log(`WARNING: Port ${port} is currently in use on ${host}. If Echo App Server is already running, that is expected. Otherwise, choose a different port.`);
    }

    await createOwnerIfNeeded(config, rl);

    const openFirewall = await yesNo(rl, 'Show firewall command for this port?', allowLan);
    if (openFirewall) {
      if (process.platform === 'win32') {
        console.log(`Windows firewall command, run as Administrator if needed:`);
        console.log(`  New-NetFirewallRule -DisplayName "Echo App Server ${port}" -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow`);
      } else {
        console.log('Linux firewall examples:');
        console.log(`  sudo ufw allow ${port}/tcp`);
        console.log(`  sudo firewall-cmd --add-port=${port}/tcp --permanent && sudo firewall-cmd --reload`);
      }
    }

    console.log('\nSetup complete.');
    console.log(`App Centers connect to: ${publicBaseUrl}`);
    console.log('Start server: echo-server start');
    console.log('Check health: echo-server doctor');
  } finally {
    rl.close();
  }
}

async function runSetupFromFlags(flags: SetupFlags): Promise<void> {
  const existing = loadConfig();
  const port = flagNumber(flags, 'port') ?? existing.port;
  if (port < 1 || port > 65535) throw new Error('Port must be 1 to 65535.');
  const protocol = flagString(flags, 'protocol') === 'https' ? 'https' : 'http';
  const host = flagString(flags, 'host') ?? existing.host;
  const publicHost = flagString(flags, 'publicHost') ?? existing.publicHost;
  const dataDir = flagString(flags, 'dataDir') ?? existing.dataDir;
  const corsOrigin = flagString(flags, 'corsOrigin') ?? existing.corsOrigin;
  const publicBaseUrl = `${protocol}://${publicHost}:${port}`;
  const config: EnvConfig = { host, port, protocol, publicHost, publicBaseUrl, dataDir, corsOrigin, githubToken: existing.githubToken };
  saveConfig(config);
  mkdirSync(absoluteDataDir(dataDir), { recursive: true });
  mkdirSync(join(absoluteDataDir(dataDir), 'media'), { recursive: true });
  mkdirSync(join(absoluteDataDir(dataDir), 'packages'), { recursive: true });

  const ownerUsername = flagString(flags, 'ownerUsername');
  const ownerPassword = flagString(flags, 'ownerPassword');
  if (ownerUsername || ownerPassword) {
    if (!ownerUsername || !ownerPassword) throw new Error('Use both --owner-username and --owner-password.');
    createOwnerDirect(config, ownerUsername, ownerPassword, flagString(flags, 'ownerDisplayName'));
  } else if (!flags.skipOwner) {
    const store = new JsonStore(absoluteDataDir(config.dataDir));
    const ownerExists = store.read().users.some((item) => item.role === 'owner');
    if (!ownerExists) console.log('No owner exists yet. Run echo-server setup or create the first owner from Echo App Center.');
  }

  const available = await isPortAvailable(host, port);
  console.log('Setup saved.');
  console.log(`Server bind: ${host}:${port}`);
  console.log(`App Centers connect to: ${publicBaseUrl}`);
  console.log(`Port available now: ${available ? 'yes' : 'no / already in use'}`);
}

function getServerEntry(): string {
  return resolve(process.cwd(), 'dist', 'index.js');
}

function startServerForeground(): void {
  const entry = getServerEntry();
  if (!existsSync(entry)) throw new Error('Server build missing: dist/index.js. Run npm run build first.');
  console.log('Starting Echo App Server. Type /help in this terminal after it starts.');
  const child = spawn(process.execPath, [entry], { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

async function stopServer(): Promise<void> {
  const config = loadConfig();
  const pid = readPid(config);
  if (!pid) {
    console.log('No Echo App Server PID file found. It may not be running, or it was started outside echo-server.');
    return;
  }
  if (!isProcessRunning(pid)) {
    console.log(`PID ${pid} is not running. Removing stale PID file.`);
    rmSync(getPidPath(config), { force: true });
    return;
  }
  process.kill(pid, 'SIGTERM');
  console.log(`Stop signal sent to Echo App Server PID ${pid}.`);
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    if (!isProcessRunning(pid)) {
      rmSync(getPidPath(config), { force: true });
      console.log('Server stopped.');
      return;
    }
  }
  console.log('Server did not exit yet. Check the server terminal or run echo-server doctor.');
}

async function restartServer(): Promise<void> {
  await stopServer();
  startServerForeground();
}

function showConfig(): void {
  const config = loadConfig();
  const env = readEnvFile();
  console.log('Echo App Server config');
  console.log(`  .env:             ${ENV_PATH}`);
  console.log(`  Bind:             ${config.host}:${config.port}`);
  console.log(`  Public URL:       ${config.publicBaseUrl}`);
  console.log(`  Data directory:   ${absoluteDataDir(config.dataDir)}`);
  console.log(`  CORS:             ${config.corsOrigin}`);
  console.log(`  GitHub token:     ${config.githubToken ? 'set' : 'not set'}`);
  console.log(`  Update repo:      ${env.get('ECHO_UPDATE_REPO') || (process.platform === 'win32' ? 'zmvz11/echo-app-server-windows' : 'zmvz11/echo-app-server-linux')}`);
  console.log(`  Update channel:   ${env.get('ECHO_UPDATE_CHANNEL') || 'stable'}`);
  console.log(`  Update asset:     ${env.get('ECHO_UPDATE_ASSET_PATTERN') || (process.platform === 'win32' ? 'echo-app-server-windows*.zip' : 'echo-app-server-linux*.zip')}`);
}

function setConfigValue(keyRaw: string | undefined, value: string | undefined): void {
  if (!keyRaw || value === undefined) {
    console.log('Usage: echo-server config set <key> <value>');
    console.log('Keys: host, port, public-url, data-dir, cors, github-token, update.repo, update.channel, update.asset');
    return;
  }
  const keyMap: Record<string, string> = {
    host: 'ECHO_SERVER_HOST',
    port: 'ECHO_SERVER_PORT',
    'public-url': 'ECHO_PUBLIC_BASE_URL',
    'data-dir': 'ECHO_DATA_DIR',
    cors: 'ECHO_CORS_ORIGIN',
    'github-token': 'ECHO_GITHUB_TOKEN',
    'update.repo': 'ECHO_UPDATE_REPO',
    'update.channel': 'ECHO_UPDATE_CHANNEL',
    'update.asset': 'ECHO_UPDATE_ASSET_PATTERN',
  };
  const envKey = keyMap[keyRaw];
  if (!envKey) throw new Error(`Unknown config key: ${keyRaw}`);
  if (envKey === 'ECHO_SERVER_PORT') {
    const port = Number.parseInt(value, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1 to 65535.');
  }
  if (envKey === 'ECHO_UPDATE_CHANNEL' && !['stable', 'beta', 'dev'].includes(value)) throw new Error('Update channel must be stable, beta, or dev.');
  const env = readEnvFile();
  env.set(envKey, value);
  writeEnvFile(env);
  console.log(`Set ${keyRaw} = ${envKey === 'ECHO_GITHUB_TOKEN' && value ? '[hidden]' : value}`);
}

function handleConfigCommand(args: string[]): void {
  const sub = (args[0] || 'show').toLowerCase();
  if (sub === 'show' || sub === 'list') return showConfig();
  if (sub === 'set') return setConfigValue(args[1], args.slice(2).join(' '));
  console.log('Usage: echo-server config show | echo-server config set <key> <value>');
}

async function showStatus(): Promise<void> {
  const config = loadConfig();
  const store = getStore(config);
  const db = store.read();
  const health = await fetchHealth(config);
  const pid = readPid(config);
  banner();
  console.log('Status');
  console.log(`  URL:              ${config.publicBaseUrl}`);
  console.log(`  Bind:             ${config.host}:${config.port}`);
  console.log(`  Health:           ${health.ok ? 'online' : 'offline'} (${health.detail})`);
  console.log(`  PID:              ${pid ? `${pid}${isProcessRunning(pid) ? ' running' : ' stale'}` : 'not found'}`);
  console.log(`  Owner exists:     ${db.users.some((u) => u.role === 'owner') ? 'yes' : 'no'}`);
  console.log(`  Users:            ${db.users.length} (${db.users.filter((u) => u.status === 'pending').length} pending)`);
  console.log(`  Apps:             ${db.apps.length}`);
  console.log(`  Releases:         ${db.releases.length}`);
  console.log(`  Clients:          ${db.clients.length}`);
  console.log(`  Audit logs:       ${db.auditLogs.length}`);
}

function showUrl(): void {
  console.log(loadConfig().publicBaseUrl);
}

function listUsers(pendingOnly: boolean): void {
  const db = getStore().read();
  const users = db.users.filter((user) => !pendingOnly || user.status === 'pending');
  if (users.length === 0) {
    console.log(pendingOnly ? 'No pending users.' : 'No users.');
    return;
  }
  for (const user of users) console.log(`${user.username.padEnd(24)} ${user.role.padEnd(12)} ${user.status.padEnd(10)} ${user.displayName ?? ''}`);
}

function addAudit(db: Database, action: string, targetType: string, targetId?: string, details?: Record<string, unknown>): void {
  db.auditLogs.unshift({ id: makeId('audit'), actorUserId: 'cli', action, targetType, targetId, details, createdAt: nowIso() });
  db.auditLogs = db.auditLogs.slice(0, 5000);
}

function setUserStatus(usernameRaw: string | undefined, status: UserStatus): void {
  if (!usernameRaw) throw new Error(`Usage: echo-server ${status === 'approved' ? 'approve' : status} <username>`);
  const username = normalizeUsername(usernameRaw);
  const store = getStore();
  const result = store.update((db) => {
    const user = db.users.find((item) => item.username === username);
    if (!user) return null;
    user.status = status;
    if (status === 'approved') {
      user.approvedAt = nowIso();
      user.approvedBy = 'cli';
    }
    if (status === 'disabled') db.sessions = db.sessions.filter((session) => session.userId !== user.id);
    addAudit(db, `cli.user.${status}`, 'user', user.id, { username });
    return { username: user.username, status: user.status };
  });
  if (!result) throw new Error(`User not found: ${username}`);
  console.log(`${result.username} is now ${result.status}.`);
}

function setUserRole(usernameRaw: string | undefined, roleRaw: string | undefined): void {
  if (!usernameRaw || !roleRaw) throw new Error('Usage: echo-server role <username> <owner|admin|app_manager|reviewer|user>');
  const role = roles.find((item) => item === roleRaw);
  if (!role) throw new Error(`Invalid role: ${roleRaw}. Allowed roles: ${roles.join(', ')}`);
  const username = normalizeUsername(usernameRaw);
  const store = getStore();
  const result = store.update((db) => {
    const user = db.users.find((item) => item.username === username);
    if (!user) return null;
    user.role = role;
    addAudit(db, 'cli.user.role.changed', 'user', user.id, { username, role });
    return { username: user.username, role: user.role };
  });
  if (!result) throw new Error(`User not found: ${username}`);
  console.log(`${result.username} role set to ${result.role}.`);
}

function listApps(): void {
  const apps = getStore().read().apps;
  if (apps.length === 0) {
    console.log('No apps have been created yet.');
    return;
  }
  for (const app of apps) console.log(`${app.id.padEnd(28)} ${app.visibility.padEnd(10)} ${app.name}`);
}

function listReleases(): void {
  const releases = getStore().read().releases;
  if (releases.length === 0) {
    console.log('No releases have been created yet.');
    return;
  }
  for (const release of releases) console.log(`${release.id.padEnd(32)} ${release.appId.padEnd(24)} ${release.version.padEnd(10)} ${release.channel.padEnd(6)} ${release.platform.padEnd(12)} ${release.status}`);
}

function listClients(): void {
  const clients = getStore().read().clients;
  if (clients.length === 0) {
    console.log('No App Center clients have checked in yet.');
    return;
  }
  for (const client of clients) console.log(`${client.id.padEnd(32)} ${client.platform.padEnd(14)} ${client.name.padEnd(24)} last=${client.lastCheckInAt}`);
}

function showLogs(countRaw?: string): void {
  const count = Math.min(Math.max(Number(countRaw ?? '20') || 20, 1), 200);
  const logs = getStore().read().auditLogs.slice(0, count);
  if (logs.length === 0) {
    console.log('No audit logs yet.');
    return;
  }
  for (const log of logs) console.log(`${log.createdAt} ${log.action} ${log.targetType}${log.targetId ? `:${log.targetId}` : ''}`);
}


function requestedPermissionsForNodeType(nodeType: string): string[] {
  if (nodeType === 'download_mirror') return ['canPullPackages', 'canPullMedia', 'canServeDownloads'];
  if (nodeType === 'standby_backup') return ['canPullPackages', 'canPullMedia', 'canServeDownloads', 'canPullDatabaseBackup', 'canBePromoted'];
  if (nodeType === 'full_backup') return ['canPullPackages', 'canPullMedia', 'canServeDownloads', 'canPullDatabaseBackup', 'canBePromoted'];
  return [];
}

function nodeFingerprint(): string {
  const env = readEnvFile();
  let value = env.get('ECHO_NODE_FINGERPRINT');
  if (value) return value;
  value = makeId('node_fp');
  env.set('ECHO_NODE_FINGERPRINT', value);
  writeEnvFile(env);
  return value;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data as T;
}

function primaryUrlFromParts(ip: string, port: string): string {
  const host = ip.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `http://${host}:${port.trim() || '8080'}`.replace(/\/$/, '');
}

async function runNodeSetup(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const rl = readline.createInterface({ input, output });
  const ask = async (prompt: string, fallback: string) => {
    const value = flagString(flags, prompt.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (value) return value;
    const answer = await rl.question(`${prompt} (${fallback}): `);
    return answer.trim() || fallback;
  };
  try {
    const nickname = await ask('Node nickname', 'Download Node');
    const typeAnswer = await ask('Node type download_mirror|standby_backup|full_backup', 'download_mirror');
    const nodeType = ['download_mirror', 'standby_backup', 'full_backup'].includes(typeAnswer) ? typeAnswer : 'download_mirror';
    const primaryIp = await ask('Primary server IP', '127.0.0.1');
    const primaryPort = await ask('Primary server port', '8080');
    const nodeIp = await ask('This node IP', '127.0.0.1');
    const nodePort = await ask('This node port', '8080');
    const primaryBaseUrl = primaryUrlFromParts(primaryIp, primaryPort);
    const nodeBaseUrl = primaryUrlFromParts(nodeIp, nodePort);
    const fingerprint = nodeFingerprint();
    const result = await postJson<{ requestId: string; status: string; message: string }>(`${primaryBaseUrl}/api/nodes/join-request`, {
      nickname,
      nodeType,
      baseUrl: nodeBaseUrl,
      fingerprint,
      requestedPermissions: requestedPermissionsForNodeType(nodeType),
    });
    const env = readEnvFile();
    env.set('ECHO_NODE_MODE', String(nodeType));
    env.set('ECHO_NODE_NICKNAME', nickname);
    env.set('ECHO_NODE_BASE_URL', nodeBaseUrl);
    env.set('ECHO_PRIMARY_BASE_URL', primaryBaseUrl);
    env.set('ECHO_NODE_REQUEST_ID', result.requestId);
    writeEnvFile(env);
    console.log('\nJoin request sent.');
    console.log(`  Primary: ${primaryBaseUrl}`);
    console.log(`  Request: ${result.requestId}`);
    console.log('Open Echo App Center → Settings → Server Nodes to accept or reject it.');
    console.log('After approval, run: echo-server node status');
  } finally {
    rl.close();
  }
}

async function runNodeStatus(): Promise<void> {
  const env = readEnvFile();
  const primary = env.get('ECHO_PRIMARY_BASE_URL');
  const requestId = env.get('ECHO_NODE_REQUEST_ID');
  const fingerprint = env.get('ECHO_NODE_FINGERPRINT');
  banner();
  console.log('Node status');
  console.log(`  Mode:        ${env.get('ECHO_NODE_MODE') || 'primary/standalone'}`);
  console.log(`  Nickname:    ${env.get('ECHO_NODE_NICKNAME') || 'not set'}`);
  console.log(`  Node URL:    ${env.get('ECHO_NODE_BASE_URL') || 'not set'}`);
  console.log(`  Primary:     ${primary || 'not set'}`);
  console.log(`  Request ID:  ${requestId || 'not set'}`);
  console.log(`  Token:       ${env.get('ECHO_NODE_TOKEN') ? 'stored' : 'not stored'}`);
  if (primary && requestId && fingerprint) {
    const status = await getJson<{ status: string; token?: string; nodeId?: string; rejectionReason?: string }>(`${primary}/api/nodes/join-request/${requestId}/status?fingerprint=${encodeURIComponent(fingerprint)}`);
    console.log(`  Primary says: ${status.status}`);
    if (status.status === 'approved' && status.token) {
      env.set('ECHO_NODE_TOKEN', status.token);
      if (status.nodeId) env.set('ECHO_NODE_ID', status.nodeId);
      writeEnvFile(env);
      console.log('  Node token saved. This node can now sync according to approved permissions.');
    }
    if (status.status === 'rejected') console.log(`  Reason: ${status.rejectionReason || 'Rejected by admin.'}`);
  }
}

async function runNodeDoctor(): Promise<void> {
  const env = readEnvFile();
  banner();
  console.log('Node doctor');
  console.log(`${env.get('ECHO_NODE_MODE') ? 'PASS' : 'WARN'} Node mode ${env.get('ECHO_NODE_MODE') || 'not configured'}`);
  console.log(`${env.get('ECHO_PRIMARY_BASE_URL') ? 'PASS' : 'WARN'} Primary URL ${env.get('ECHO_PRIMARY_BASE_URL') || 'not configured'}`);
  console.log(`${env.get('ECHO_NODE_BASE_URL') ? 'PASS' : 'WARN'} Node URL ${env.get('ECHO_NODE_BASE_URL') || 'not configured'}`);
  console.log(`${env.get('ECHO_NODE_TOKEN') ? 'PASS' : 'WARN'} Node token ${env.get('ECHO_NODE_TOKEN') ? 'stored' : 'not approved yet'}`);
  if (env.get('ECHO_PRIMARY_BASE_URL')) {
    try { await getJson(`${env.get('ECHO_PRIMARY_BASE_URL')}/health`); console.log('PASS Primary health reachable'); }
    catch (error) { console.log(`WARN Primary health ${error instanceof Error ? error.message : String(error)}`); }
  }
}

function runNodePromote(): void {
  const env = readEnvFile();
  env.set('ECHO_NODE_MODE', 'primary');
  env.delete('ECHO_PRIMARY_BASE_URL');
  env.delete('ECHO_NODE_TOKEN');
  env.delete('ECHO_NODE_REQUEST_ID');
  writeEnvFile(env);
  console.log('This server has been marked as primary mode. Review .env, restart Echo App Server, and point App Centers at this server.');
}

async function handleNodeCommand(args: string[]): Promise<void> {
  const sub = (args.shift() || 'status').toLowerCase();
  if (sub === 'setup' || sub === 'join') return runNodeSetup(args);
  if (sub === 'status') return runNodeStatus();
  if (sub === 'doctor') return runNodeDoctor();
  if (sub === 'promote') return runNodePromote();
  console.log('Usage: echo-server node setup | status | doctor | promote');
}

function showSyncStatus(): void {
  const db = getStore().read();
  banner();
  console.log('Sync status');
  console.log(`  Enabled:           ${db.syncSettings?.enabled ? 'yes' : 'no'}`);
  console.log(`  Require approval:  ${db.syncSettings?.requireApproval !== false ? 'yes' : 'no'}`);
  console.log(`  Interval:          ${db.syncSettings?.intervalMinutes ?? 15} minutes`);
  console.log(`  Nodes:             ${db.nodes.length}`);
  console.log(`  Pending requests:  ${db.nodeRequests.filter((item) => item.status === 'pending').length}`);
}

function listNodeRequests(): void {
  const requests = getStore().read().nodeRequests.filter((item) => item.status === 'pending');
  if (!requests.length) { console.log('No pending node requests.'); return; }
  for (const request of requests) console.log(`${request.id.padEnd(34)} ${request.nodeType.padEnd(16)} ${request.nickname.padEnd(24)} ${request.baseUrl}`);
}

function listNodes(): void {
  const nodes = getStore().read().nodes;
  if (!nodes.length) { console.log('No approved nodes.'); return; }
  for (const node of nodes) console.log(`${node.id.padEnd(30)} ${node.nodeType.padEnd(16)} ${node.status.padEnd(10)} ${node.nickname.padEnd(24)} ${node.baseUrl}`);
}

function approveNodeRequest(requestId?: string): void {
  if (!requestId) throw new Error('Usage: echo-server sync approve <request-id>');
  const result = getStore().update((db) => {
    const request = db.nodeRequests.find((item) => item.id === requestId && item.status === 'pending');
    if (!request) return null;
    const token = makeId('node_token');
    const permissions = Object.fromEntries(['canPullPackages','canPullMedia','canServeDownloads','canPullDatabaseBackup','canBePromoted','canRunAdminApi'].map((key) => [key, requestedPermissionsForNodeType(request.nodeType).includes(key)])) as any;
    const node = { id: makeId('node'), nickname: request.nickname, nodeType: request.nodeType, baseUrl: request.baseUrl, fingerprint: request.fingerprint, token, status: 'approved' as const, permissions, createdAt: nowIso(), approvedAt: nowIso(), approvedBy: 'cli', healthMessage: 'Approved from CLI.' };
    request.status = 'approved'; request.reviewedAt = nowIso(); request.reviewedBy = 'cli'; request.nodeId = node.id; request.token = token;
    db.nodes.unshift(node);
    addAudit(db, 'cli.node.approved', 'node', node.id, { nickname: node.nickname });
    return node;
  });
  if (!result) throw new Error(`Pending request not found: ${requestId}`);
  console.log(`Approved ${result.nickname}. The node can retrieve its token with echo-server node status.`);
}

function rejectNodeRequest(requestId?: string): void {
  if (!requestId) throw new Error('Usage: echo-server sync reject <request-id>');
  const request = getStore().update((db) => {
    const item = db.nodeRequests.find((candidate) => candidate.id === requestId && candidate.status === 'pending');
    if (!item) return null;
    item.status = 'rejected'; item.reviewedAt = nowIso(); item.reviewedBy = 'cli'; item.rejectionReason = 'Rejected from CLI.';
    addAudit(db, 'cli.node.rejected', 'node_request', item.id, { nickname: item.nickname });
    return item;
  });
  if (!request) throw new Error(`Pending request not found: ${requestId}`);
  console.log(`Rejected ${request.nickname}.`);
}

function runSyncSetup(): void {
  const store = getStore();
  const syncSettings = store.update((db) => {
    db.syncSettings = { enabled: true, requireApproval: true, intervalMinutes: 15, allowDownloadMirrors: true, allowStandbyBackups: true, lastConfiguredAt: nowIso() };
    addAudit(db, 'cli.sync.configured', 'sync_settings');
    return db.syncSettings;
  });
  console.log('Sync/node approval is enabled.');
  console.log(`  Interval: ${syncSettings.intervalMinutes} minutes`);
  console.log('Nodes can now run: echo-server node setup');
}

function runSyncNow(): void {
  const nodes = getStore().update((db) => {
    for (const node of db.nodes) { node.lastSyncAt = nowIso(); node.healthMessage = 'Manual sync requested from CLI.'; }
    addAudit(db, 'cli.sync.now', 'sync');
    return db.nodes;
  });
  console.log(`Marked sync requested for ${nodes.length} node(s).`);
}

async function handleSyncCommand(args: string[]): Promise<void> {
  const sub = (args.shift() || 'status').toLowerCase();
  if (sub === 'setup') return runSyncSetup();
  if (sub === 'status') return showSyncStatus();
  if (sub === 'nodes') return listNodes();
  if (sub === 'requests') return listNodeRequests();
  if (sub === 'approve') return approveNodeRequest(args[0]);
  if (sub === 'reject') return rejectNodeRequest(args[0]);
  if (sub === 'now' || sub === 'run') return runSyncNow();
  console.log('Usage: echo-server sync setup | status | nodes | requests | approve <id> | reject <id> | now');
}

function pushCheck(results: CheckResult[], level: CheckLevel, name: string, detail?: string): void {
  results.push({ level, name, detail });
}

function printCheck(result: CheckResult): void {
  const label = result.level.padEnd(4);
  console.log(`${label} ${result.name}${result.detail ? ` - ${result.detail}` : ''}`);
}

async function runDoctor(): Promise<void> {
  const config = loadConfig();
  const results: CheckResult[] = [];
  const envExists = existsSync(ENV_PATH);
  pushCheck(results, envExists ? 'PASS' : 'WARN', '.env file', envExists ? ENV_PATH : 'missing; run echo-server setup');

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  pushCheck(results, nodeMajor >= 20 ? 'PASS' : 'FAIL', 'Node.js version', process.version);

  const registry = process.env.npm_config_registry || '';
  if (registry && registry.includes('applied-' + 'caas')) pushCheck(results, 'FAIL', 'npm registry', registry);
  else pushCheck(results, 'PASS', 'npm registry', registry || 'default/public npm registry');

  pushCheck(results, config.port >= 1 && config.port <= 65535 ? 'PASS' : 'FAIL', 'Server port', String(config.port));

  try {
    new URL(config.publicBaseUrl);
    pushCheck(results, 'PASS', 'Public URL', config.publicBaseUrl);
  } catch {
    pushCheck(results, 'FAIL', 'Public URL', config.publicBaseUrl);
  }

  const dataDir = absoluteDataDir(config.dataDir);
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.R_OK | constants.W_OK);
    pushCheck(results, 'PASS', 'Data directory writable', dataDir);
  } catch (error) {
    pushCheck(results, 'FAIL', 'Data directory writable', error instanceof Error ? error.message : String(error));
  }

  try {
    mkdirSync(join(dataDir, 'media'), { recursive: true });
    mkdirSync(join(dataDir, 'packages'), { recursive: true });
    pushCheck(results, 'PASS', 'Media/package directories', 'ready');
  } catch (error) {
    pushCheck(results, 'FAIL', 'Media/package directories', error instanceof Error ? error.message : String(error));
  }

  let db: Database | undefined;
  try {
    db = getStore(config).read();
    pushCheck(results, 'PASS', 'Database file', 'readable');
  } catch (error) {
    pushCheck(results, 'FAIL', 'Database file', error instanceof Error ? error.message : String(error));
  }

  if (db) pushCheck(results, db.users.some((user) => user.role === 'owner') ? 'PASS' : 'WARN', 'Owner account', db.users.some((user) => user.role === 'owner') ? 'exists' : 'missing; run echo-server setup or use App Center first-connect setup');

  const pid = readPid(config);
  if (pid) pushCheck(results, isProcessRunning(pid) ? 'PASS' : 'WARN', 'PID file', `${pid}${isProcessRunning(pid) ? ' running' : ' stale'}`);
  else pushCheck(results, 'WARN', 'PID file', 'not found; server may be stopped');

  const health = await fetchHealth(config);
  pushCheck(results, health.ok ? 'PASS' : 'WARN', 'Health endpoint', health.detail);

  const portAvailable = await isPortAvailable(config.host, config.port);
  const portLevel: CheckLevel = health.ok ? 'PASS' : portAvailable ? 'PASS' : 'WARN';
  const portDetail = health.ok ? 'server is using/responding on the configured port' : portAvailable ? 'available' : 'in use but health did not respond';
  pushCheck(results, portLevel, 'Port check', portDetail);

  if (process.platform === 'win32') pushCheck(results, 'WARN', 'Command name', 'Use echo-server. The command echo is reserved by Windows.');
  else pushCheck(results, 'PASS', 'Command name', 'echo-server');

  const envForUpdate = readEnvFile();
  pushCheck(results, 'PASS', 'Update service', serviceDoctorSummary());
  pushCheck(results, envForUpdate.get('ECHO_UPDATE_REPO') ? 'PASS' : 'WARN', 'Update repo', envForUpdate.get('ECHO_UPDATE_REPO') || 'not set; using platform default repo');
  pushCheck(results, envForUpdate.get('ECHO_UPDATE_CHANNEL') ? 'PASS' : 'WARN', 'Update channel', envForUpdate.get('ECHO_UPDATE_CHANNEL') || 'not set; using stable');

  banner();
  console.log('Doctor');
  for (const result of results) printCheck(result);
  const fails = results.filter((item) => item.level === 'FAIL').length;
  const warns = results.filter((item) => item.level === 'WARN').length;
  console.log(`\nSummary: ${fails} fail, ${warns} warn, ${results.length - fails - warns} pass`);
  if (fails > 0) process.exitCode = 1;
}

async function openDashboard(): Promise<void> {
  const url = `${loadConfig().publicBaseUrl}/admin`;
  console.log(`Echo App Server dashboard: ${url}`);
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Printing the URL is enough when no desktop opener is available.
  }
}


function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function showInstallInfo(): void {
  const env = readEnvFile();
  const repo = env.get('ECHO_UPDATE_REPO') || (process.platform === 'win32' ? 'zmvz11/echo-app-server-windows' : 'zmvz11/echo-app-server-linux');
  const asset = env.get('ECHO_UPDATE_ASSET_PATTERN') || (process.platform === 'win32' ? 'echo-app-server-windows*.zip' : 'echo-app-server-linux*.zip');
  const channel = env.get('ECHO_UPDATE_CHANNEL') || 'stable';
  banner();
  console.log('Install and update source');
  console.log(`  Version:        ${packageVersion()}`);
  console.log(`  Repo:           ${repo}`);
  console.log(`  Channel:        ${channel}`);
  console.log(`  Asset pattern:  ${asset}`);
  console.log(`  GitHub token:   ${env.get('ECHO_GITHUB_TOKEN') ? 'configured' : 'not configured / public repo mode'}`);
  console.log('');
  if (process.platform === 'win32') {
    console.log('Windows one-line install:');
    console.log('  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/zmvz11/echo-app-server-windows/main/scripts/install.ps1 | iex"');
  } else {
    console.log('Linux one-line install:');
    console.log('  curl -fsSL https://raw.githubusercontent.com/zmvz11/echo-app-server-linux/main/scripts/install.sh | bash');
  }
  console.log('');
  console.log('Update commands:');
  console.log('  echo-server update --check');
  console.log('  echo-server update --dry-run');
  console.log('  echo-server update');
  console.log('  echo-server update --rollback');
}

async function runOnboard(args: string[]): Promise<void> {
  console.log('Echo App Server onboarding');
  const flags = parseFlags(args);
  if (flags.defaults || flagString(flags, 'port') || flagString(flags, 'host') || flagString(flags, 'ownerUsername')) await runSetupFromFlags(flags);
  else await runSetupWizard();
  console.log('\nRunning doctor after onboarding...');
  await runDoctor();
  console.log('\nNext commands');
  console.log('  echo-server service install');
  console.log('  echo-server service start');
  console.log('  echo-server dashboard');
  console.log('  echo-server install-info');
  console.log('  echo-server update --check');
}

async function showCommandCenter(interactive = true): Promise<void> {
  await showStatus();
  console.log('\nQuick commands');
  console.log('  /onboard      Guided first-run setup');
  console.log('  /status       Server status');
  console.log('  /doctor       Diagnostics');
  console.log('  /dashboard    Open/show dashboard URL');
  console.log('  /service      Service/logon task status');
  console.log('  /update       Check GitHub Releases for updates');
  console.log('  /install-info Show GitHub install/update source');
  console.log('  /sync         Show sync/node status');
  console.log('  /nodes        List approved nodes');
  console.log('  /users        List users');
  console.log('  /apps         List apps');
  console.log('  /help         Full command list');
  console.log('  /exit         Close this command center');
  if (!interactive || !process.stdin.isTTY) return;

  const rl = readline.createInterface({ input, output, prompt: 'echo-server> ' });
  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); continue; }
    if (trimmed === '/exit' || trimmed === 'exit' || trimmed === 'quit') break;
    const parsed = parseArgs(trimmed);
    const slashCommand = parsed.shift() ?? '';
    const normalized = slashCommand.startsWith('/') ? slashCommand.slice(1) : slashCommand;
    await dispatchCommand(normalized, parsed);
    rl.prompt();
  }
  rl.close();
}

async function dispatchCommand(commandInput: string, args: string[]): Promise<void> {
  const command = commandInput.toLowerCase();
  if (!command || command === 'home') return showCommandCenter(false);
  if (command === 'help' || command === '?' || command === '--help' || command === '-h') return printHelp();
  if (command === 'setup') {
    const flags = parseFlags(args);
    if (flags.defaults || flagString(flags, 'port') || flagString(flags, 'host') || flagString(flags, 'ownerUsername')) return runSetupFromFlags(flags);
    return runSetupWizard();
  }
  if (command === 'onboard') return runOnboard(args);
  if (command === 'doctor' || command === 'check') return runDoctor();
  if (command === 'status') return showStatus();
  if (command === 'url') return showUrl();
  if (command === 'dashboard') return openDashboard();
  if (command === 'install-info') return showInstallInfo();
  if (command === 'config') return handleConfigCommand(args);
  if (command === 'service' || command === 'daemon') return runServiceCommand(args);
  if (command === 'update') return runUpdateCommand(args);
  if (command === 'node') return handleNodeCommand(args);
  if (command === 'sync') return handleSyncCommand(args);
  if (command === 'nodes') return listNodes();
  if (command === 'start' || command === 'serve') return startServerForeground();
  if (command === 'stop') return stopServer();
  if (command === 'restart') return restartServer();
  if (command === 'users') return listUsers(args[0] === 'pending');
  if (command === 'approve') return setUserStatus(args[0], 'approved');
  if (command === 'reject') return setUserStatus(args[0], 'rejected');
  if (command === 'disable') return setUserStatus(args[0], 'disabled');
  if (command === 'role') return setUserRole(args[0], args[1]);
  if (command === 'apps') return listApps();
  if (command === 'releases') return listReleases();
  if (command === 'clients') return listClients();
  if (command === 'logs') return showLogs(args[0]);

  console.error(`Unknown command: ${commandInput}`);
  printHelp();
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const command = (rawArgs[0] ?? '').replace(/^\//, '').toLowerCase();
  const args = rawArgs.slice(1);
  if (!command) return showCommandCenter(true);
  return dispatchCommand(command, args);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
