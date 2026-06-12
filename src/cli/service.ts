import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const serviceName = 'EchoAppServer';
const linuxServiceName = 'echo-app-server.service';

function serverEntry(): string {
  return resolve(process.cwd(), 'dist', 'index.js');
}

function ensureBuilt(): void {
  if (!existsSync(serverEntry())) throw new Error('Server build missing: dist/index.js. Run npm run build first.');
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
}

function windowsService(args: string[]): void {
  const action = (args[0] || 'status').toLowerCase();
  ensureBuilt();
  if (action === 'install') {
    const taskCommand = `"${process.execPath}" "${serverEntry()}"`;
    run('schtasks', ['/Create', '/TN', serviceName, '/SC', 'ONLOGON', '/TR', taskCommand, '/F']);
    console.log('Installed Echo App Server as a Windows logon task. Use echo-server service start to run it now.');
    return;
  }
  if (action === 'uninstall' || action === 'remove') return run('schtasks', ['/Delete', '/TN', serviceName, '/F']);
  if (action === 'start') return run('schtasks', ['/Run', '/TN', serviceName]);
  if (action === 'stop') return run('schtasks', ['/End', '/TN', serviceName]);
  if (action === 'restart') {
    try { run('schtasks', ['/End', '/TN', serviceName]); } catch {}
    return run('schtasks', ['/Run', '/TN', serviceName]);
  }
  run('schtasks', ['/Query', '/TN', serviceName]);
}

function linuxService(args: string[]): void {
  const action = (args[0] || 'status').toLowerCase();
  ensureBuilt();
  const servicePath = join(homedir(), '.config', 'systemd', 'user', linuxServiceName);
  if (action === 'install') {
    mkdirSync(dirname(servicePath), { recursive: true });
    writeFileSync(servicePath, `[Unit]\nDescription=Echo App Server\nAfter=network.target\n\n[Service]\nType=simple\nWorkingDirectory=${process.cwd()}\nExecStart=${process.execPath} ${serverEntry()}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`, 'utf8');
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', linuxServiceName]);
    console.log('Installed Echo App Server as a systemd user service. Use echo-server service start to run it now.');
    return;
  }
  if (action === 'uninstall' || action === 'remove') {
    try { run('systemctl', ['--user', 'disable', '--now', linuxServiceName]); } catch {}
    console.log(`Service file: ${servicePath}`);
    console.log('Remove that file if you want it fully deleted.');
    return;
  }
  if (action === 'start') return run('systemctl', ['--user', 'start', linuxServiceName]);
  if (action === 'stop') return run('systemctl', ['--user', 'stop', linuxServiceName]);
  if (action === 'restart') return run('systemctl', ['--user', 'restart', linuxServiceName]);
  run('systemctl', ['--user', 'status', linuxServiceName, '--no-pager']);
}

export function runServiceCommand(args: string[]): void {
  const action = (args[0] || 'status').toLowerCase();
  if (!['install', 'uninstall', 'remove', 'start', 'stop', 'restart', 'status'].includes(action)) {
    console.log('Usage: echo-server service <install|uninstall|start|stop|restart|status>');
    return;
  }
  try {
    if (process.platform === 'win32') windowsService(args);
    else linuxService(args);
  } catch (error) {
    console.log(`Service command could not complete: ${error instanceof Error ? error.message : String(error)}`);
    if (process.platform !== 'win32') console.log('Linux service commands require systemd user services. The server can still run with: echo-server start');
    else console.log('Windows service commands use Task Scheduler. Try from a normal user session or run as Administrator if needed.');
  }
}

export function serviceDoctorSummary(): string {
  if (process.platform === 'win32') return 'Windows scheduled task support available through echo-server service install';
  return 'systemd user service support available through echo-server service install';
}
