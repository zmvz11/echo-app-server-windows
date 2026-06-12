import readline from 'node:readline';
import type { Server } from 'node:http';
import type { Env } from '../config/env.js';
import { makeId, nowIso } from '../lib/id.js';
import type { AuditLog, Database, UserRole } from '../types.js';
import type { JsonStore } from '../lib/storage.js';
import { normalizeUsername } from '../auth/usernameRules.js';

type CommandContext = {
  store: JsonStore;
  env: Env;
  server: Server;
  startedAt: Date;
};

const roles: UserRole[] = ['owner', 'admin', 'app_manager', 'reviewer', 'user'];

function parseArgs(input: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) args.push(match[1] ?? match[2] ?? match[3] ?? '');
  return args;
}

function addAudit(db: Database, action: string, targetType: string, targetId?: string, details?: Record<string, unknown>): AuditLog {
  const item: AuditLog = { id: makeId('audit'), actorUserId: 'cli', action, targetType, targetId, details, createdAt: nowIso() };
  db.auditLogs.unshift(item);
  db.auditLogs = db.auditLogs.slice(0, 5000);
  return item;
}

function printHelp(): void {
  console.log(`
Echo App Server runtime slash commands

Core:
  /help                         Show this command list
  /status                       Show server health, setup status, and counts
  /setup                        Show first-owner setup state and App Center connection info
  /url                          Show the URL clients should use
  /clear                        Clear the console
  /stop                         Stop Echo App Server
  /exit                         Stop Echo App Server

Users:
  /users                        List all users
  /users pending                List pending users only
  /approve <username>           Approve a pending user
  /reject <username>            Reject a user
  /disable <username>           Disable a user and clear their sessions
  /role <username> <role>       Set role: owner, admin, app_manager, reviewer, user

Apps and releases:
  /apps                         List apps
  /releases                     List releases
  /clients                      List connected App Centers
  /logs [count]                 Show latest audit logs, default 10

Outside this server terminal:
  echo-server status
  echo-server doctor
  echo-server setup
`);
}

function getPublicUrl(env: Env): string {
  return env.publicBaseUrl || `http://${env.host}:${env.port}`;
}

function showStatus(ctx: CommandContext): void {
  const db = ctx.store.read();
  const ownerExists = db.users.some((u) => u.role === 'owner');
  const uptimeSeconds = Math.floor((Date.now() - ctx.startedAt.getTime()) / 1000);
  const pendingUsers = db.users.filter((u) => u.status === 'pending').length;
  const publishedReleases = db.releases.filter((r) => r.status === 'published').length;
  console.log('Echo App Server status');
  console.log(`  URL:              ${getPublicUrl(ctx.env)}`);
  console.log(`  Bind:             ${ctx.env.host}:${ctx.env.port}`);
  console.log(`  Data directory:   ${ctx.env.dataDir}`);
  console.log(`  Uptime:           ${uptimeSeconds}s`);
  console.log(`  PID:              ${process.pid}`);
  console.log(`  Owner exists:     ${ownerExists ? 'yes' : 'no'}`);
  console.log(`  Users:            ${db.users.length} (${pendingUsers} pending)`);
  console.log(`  Apps:             ${db.apps.length}`);
  console.log(`  Releases:         ${db.releases.length} (${publishedReleases} published)`);
  console.log(`  Clients:          ${db.clients.length}`);
  console.log(`  Audit logs:       ${db.auditLogs.length}`);
}

function showSetup(ctx: CommandContext): void {
  const db = ctx.store.read();
  const ownerExists = db.users.some((u) => u.role === 'owner');
  console.log('Echo setup');
  console.log(`  Server URL for App Center: ${getPublicUrl(ctx.env)}`);
  console.log(`  Owner account exists:      ${ownerExists ? 'yes' : 'no'}`);
  if (!ownerExists) {
    console.log('  Next step: open Echo App Center, enter this server IP/port, click Connect to Server, then create the first Owner account.');
    console.log('  Or stop this server and run: echo-server setup');
  } else {
    console.log('  Setup is locked. New users must create accounts and wait for admin approval.');
  }
}

function listUsers(ctx: CommandContext, pendingOnly: boolean): void {
  const users = ctx.store.read().users.filter((u) => !pendingOnly || u.status === 'pending');
  if (users.length === 0) {
    console.log(pendingOnly ? 'No pending users.' : 'No users.');
    return;
  }
  for (const user of users) console.log(`${user.username.padEnd(24)} ${user.role.padEnd(12)} ${user.status.padEnd(10)} ${user.displayName ?? ''}`);
}

function setUserStatus(ctx: CommandContext, usernameRaw: string | undefined, status: 'approved' | 'rejected' | 'disabled'): void {
  if (!usernameRaw) {
    console.log(`Usage: /${status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'disable'} <username>`);
    return;
  }
  const username = normalizeUsername(usernameRaw);
  const result = ctx.store.update((db) => {
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
  if (!result) {
    console.log(`User not found: ${username}`);
    return;
  }
  console.log(`${result.username} is now ${result.status}.`);
}

function setUserRole(ctx: CommandContext, usernameRaw: string | undefined, roleRaw: string | undefined): void {
  if (!usernameRaw || !roleRaw) {
    console.log('Usage: /role <username> <owner|admin|app_manager|reviewer|user>');
    return;
  }
  const role = roles.find((item) => item === roleRaw);
  if (!role) {
    console.log(`Invalid role: ${roleRaw}`);
    console.log(`Allowed roles: ${roles.join(', ')}`);
    return;
  }
  const username = normalizeUsername(usernameRaw);
  const result = ctx.store.update((db) => {
    const user = db.users.find((item) => item.username === username);
    if (!user) return null;
    user.role = role;
    addAudit(db, 'cli.user.role.changed', 'user', user.id, { username, role });
    return { username: user.username, role: user.role };
  });
  if (!result) {
    console.log(`User not found: ${username}`);
    return;
  }
  console.log(`${result.username} role set to ${result.role}.`);
}

function listApps(ctx: CommandContext): void {
  const apps = ctx.store.read().apps;
  if (apps.length === 0) {
    console.log('No apps have been created yet.');
    return;
  }
  for (const app of apps) console.log(`${app.id.padEnd(28)} ${app.visibility.padEnd(10)} ${app.name}`);
}

function listReleases(ctx: CommandContext): void {
  const releases = ctx.store.read().releases;
  if (releases.length === 0) {
    console.log('No releases have been created yet.');
    return;
  }
  for (const release of releases) console.log(`${release.id.padEnd(32)} ${release.appId.padEnd(24)} ${release.version.padEnd(10)} ${release.channel.padEnd(6)} ${release.platform.padEnd(12)} ${release.status}`);
}

function listClients(ctx: CommandContext): void {
  const clients = ctx.store.read().clients;
  if (clients.length === 0) {
    console.log('No App Center clients have checked in yet.');
    return;
  }
  for (const client of clients) console.log(`${client.id.padEnd(32)} ${client.platform.padEnd(14)} ${client.name.padEnd(24)} last=${client.lastCheckInAt}`);
}

function showLogs(ctx: CommandContext, countRaw: string | undefined): void {
  const count = Math.min(Math.max(Number(countRaw ?? '10') || 10, 1), 100);
  const logs = ctx.store.read().auditLogs.slice(0, count);
  if (logs.length === 0) {
    console.log('No audit logs yet.');
    return;
  }
  for (const log of logs) console.log(`${log.createdAt} ${log.action} ${log.targetType}${log.targetId ? `:${log.targetId}` : ''}`);
}

function handleCommand(ctx: CommandContext, line: string): void {
  const args = parseArgs(line.trim());
  const command = (args.shift() ?? '').toLowerCase();
  switch (command) {
    case '/help':
    case '/?':
      printHelp();
      break;
    case '/status':
      showStatus(ctx);
      break;
    case '/setup':
      showSetup(ctx);
      break;
    case '/url':
      console.log(`Client URL: ${getPublicUrl(ctx.env)}`);
      console.log(`Bind:       ${ctx.env.host}:${ctx.env.port}`);
      break;
    case '/users':
      listUsers(ctx, args[0] === 'pending');
      break;
    case '/approve':
      setUserStatus(ctx, args[0], 'approved');
      break;
    case '/reject':
      setUserStatus(ctx, args[0], 'rejected');
      break;
    case '/disable':
      setUserStatus(ctx, args[0], 'disabled');
      break;
    case '/role':
      setUserRole(ctx, args[0], args[1]);
      break;
    case '/apps':
      listApps(ctx);
      break;
    case '/releases':
      listReleases(ctx);
      break;
    case '/clients':
      listClients(ctx);
      break;
    case '/logs':
      showLogs(ctx, args[0]);
      break;
    case '/clear':
      console.clear();
      break;
    case '/stop':
    case '/exit':
    case '/quit':
      console.log('Stopping Echo App Server...');
      ctx.server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
      break;
    default:
      if (command.startsWith('/')) console.log(`Unknown command: ${command}. Type /help.`);
      break;
  }
}

export function startServerCommandConsole(ctx: Omit<CommandContext, 'startedAt'>): void {
  if (process.env.ECHO_SERVER_COMMANDS === 'false') return;
  if (!process.stdin.isTTY && process.env.ECHO_SERVER_COMMANDS_FORCE !== 'true') return;

  const fullContext: CommandContext = { ...ctx, startedAt: new Date() };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'echo-server> ' });

  console.log('Echo App Server command console ready. Type /help for slash commands.');
  rl.prompt();
  rl.on('line', (line) => {
    try {
      handleCommand(fullContext, line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`Command failed: ${message}`);
    }
    rl.prompt();
  });
}
