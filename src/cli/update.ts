// GitHub Releases updater with --check, --dry-run, and --rollback support.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

type UpdateChannel = 'stable' | 'beta' | 'dev';
type UpdateOptions = {
  checkOnly: boolean;
  dryRun: boolean;
  rollback: boolean;
  channel?: UpdateChannel;
  repo?: string;
  assetPattern?: string;
};

type EnvValues = Map<string, string>;
type GitHubAsset = { name: string; browser_download_url: string; size?: number };
type GitHubRelease = { tag_name: string; name?: string; prerelease?: boolean; draft?: boolean; body?: string; assets?: GitHubAsset[] };

type UpdateConfig = {
  repo: string;
  channel: UpdateChannel;
  assetPattern: string;
  githubToken: string;
  dataDir: string;
};

const envPath = resolve(process.cwd(), '.env');
const skipNames = new Set(['.git', '.env', 'data', 'node_modules', 'dist', 'release']);

function readEnvFile(path = envPath): EnvValues {
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

function defaultRepo(): string {
  return process.platform === 'win32' ? 'zmvz11/echo-app-server-windows' : 'zmvz11/echo-app-server-linux';
}

function defaultAssetPattern(): string {
  return process.platform === 'win32' ? 'echo-app-server-windows*.zip' : 'echo-app-server-linux*.zip';
}

function parseOptions(args: string[]): UpdateOptions {
  const options: UpdateOptions = { checkOnly: false, dryRun: false, rollback: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--check' || arg === 'check') options.checkOnly = true;
    else if (arg === '--dry-run' || arg === 'dry-run') options.dryRun = true;
    else if (arg === '--rollback' || arg === 'rollback') options.rollback = true;
    else if (arg === '--repo') options.repo = args[++index];
    else if (arg.startsWith('--repo=')) options.repo = arg.slice('--repo='.length);
    else if (arg === '--asset' || arg === '--asset-pattern') options.assetPattern = args[++index];
    else if (arg.startsWith('--asset=')) options.assetPattern = arg.slice('--asset='.length);
    else if (arg === '--channel') options.channel = normalizeChannel(args[++index]);
    else if (arg.startsWith('--channel=')) options.channel = normalizeChannel(arg.slice('--channel='.length));
  }
  return options;
}

function normalizeChannel(value: string | undefined): UpdateChannel {
  if (value === 'beta' || value === 'dev') return value;
  return 'stable';
}

function loadUpdateConfig(options: UpdateOptions): UpdateConfig {
  const env = readEnvFile();
  return {
    repo: options.repo || env.get('ECHO_UPDATE_REPO') || defaultRepo(),
    channel: options.channel || normalizeChannel(env.get('ECHO_UPDATE_CHANNEL')),
    assetPattern: options.assetPattern || env.get('ECHO_UPDATE_ASSET_PATTERN') || defaultAssetPattern(),
    githubToken: env.get('ECHO_GITHUB_TOKEN') || '',
    dataDir: resolve(process.cwd(), env.get('ECHO_DATA_DIR') || './data'),
  };
}

function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function parseVersion(value: string): number[] {
  return value.replace(/^v/i, '').split(/[.-]/).map((item) => Number.parseInt(item, 10)).map((num) => (Number.isFinite(num) ? num : 0));
}

function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (let index = 0; index < Math.max(av.length, bv.length); index += 1) {
    const left = av[index] ?? 0;
    const right = bv[index] ?? 0;
    if (left !== right) return left - right;
  }
  return a.localeCompare(b);
}

function githubHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Echo-App-Server-Updater',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) throw new Error(`GitHub request failed: HTTP ${response.status} ${response.statusText}`);
  return await response.json() as T;
}

async function fetchRelease(config: UpdateConfig): Promise<GitHubRelease> {
  const [owner, repo] = config.repo.split('/');
  if (!owner || !repo) throw new Error(`Invalid GitHub repo: ${config.repo}. Expected owner/repo.`);
  if (config.channel === 'stable') {
    return githubJson<GitHubRelease>(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, config.githubToken);
  }
  const releases = await githubJson<GitHubRelease[]>(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`, config.githubToken);
  const wanted = releases.find((release) => !release.draft && (config.channel === 'dev' || release.prerelease || release.tag_name.toLowerCase().includes('beta')));
  if (!wanted) throw new Error(`No ${config.channel} release found in ${config.repo}.`);
  return wanted;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function selectAsset(release: GitHubRelease, pattern: string): GitHubAsset {
  const assets = release.assets ?? [];
  const regex = wildcardToRegExp(pattern);
  const match = assets.find((asset) => regex.test(asset.name)) || assets.find((asset) => asset.name.endsWith('.zip'));
  if (!match) {
    const names = assets.map((asset) => asset.name).join(', ') || 'none';
    throw new Error(`No matching release asset found for pattern ${pattern}. Available assets: ${names}`);
  }
  return match;
}

async function downloadAsset(asset: GitHubAsset, token: string, destination: string): Promise<void> {
  const response = await fetch(asset.browser_download_url, { headers: token ? { Authorization: `Bearer ${token}`, 'User-Agent': 'Echo-App-Server-Updater' } : { 'User-Agent': 'Echo-App-Server-Updater' } });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, buffer);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureUpdateDirs(config: UpdateConfig): { updatesDir: string; downloadsDir: string; backupsDir: string; tempDir: string } {
  const updatesDir = join(config.dataDir, 'updates');
  const downloadsDir = join(updatesDir, 'downloads');
  const backupsDir = join(updatesDir, 'backups');
  const tempDir = join(updatesDir, 'tmp');
  mkdirSync(downloadsDir, { recursive: true });
  mkdirSync(backupsDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });
  return { updatesDir, downloadsDir, backupsDir, tempDir };
}

function copyProject(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const item of readdirSync(from, { withFileTypes: true })) {
    if (skipNames.has(item.name)) continue;
    const source = join(from, item.name);
    const dest = join(to, item.name);
    cpSync(source, dest, { recursive: true, force: true, filter: (path) => !skipNames.has(basename(path)) });
  }
}

function createBackup(config: UpdateConfig): string {
  const dirs = ensureUpdateDirs(config);
  const backupPath = join(dirs.backupsDir, `echo-server-backup-${timestamp()}`);
  copyProject(process.cwd(), backupPath);
  if (existsSync(envPath)) cpSync(envPath, join(backupPath, '.env'), { force: true });
  writeFileSync(join(backupPath, 'BACKUP_INFO.txt'), `Echo App Server backup\nCreated: ${new Date().toISOString()}\nSource: ${process.cwd()}\n`, 'utf8');
  return backupPath;
}

function latestBackup(config: UpdateConfig): string | undefined {
  const backupsDir = join(config.dataDir, 'updates', 'backups');
  if (!existsSync(backupsDir)) return undefined;
  const backups = readdirSync(backupsDir).map((name) => join(backupsDir, name)).filter((item) => statSync(item).isDirectory()).sort();
  return backups.at(-1);
}

function extractZip(zipPath: string, destination: string): void {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(destination)} -Force`], { stdio: 'inherit' });
    return;
  }
  execFileSync('unzip', ['-q', zipPath, '-d', destination], { stdio: 'inherit' });
}

function findPackageRoot(base: string): string {
  const queue = [base];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (existsSync(join(current, 'package.json')) && existsSync(join(current, 'src', 'index.ts'))) return current;
    for (const item of readdirSync(current, { withFileTypes: true })) {
      if (item.isDirectory()) queue.push(join(current, item.name));
    }
  }
  throw new Error('Downloaded update did not contain a valid Echo App Server package root.');
}

function runNpmInstallAndBuild(): void {
  execFileSync('npm', ['install', '--include=dev', '--no-audit', '--no-fund', '--registry', 'https://registry.npmjs.org/'], { stdio: 'inherit', shell: process.platform === 'win32' });
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
}

function readPid(dataDir: string): number | undefined {
  const pidPath = join(dataDir, 'echo-app-server.pid');
  if (!existsSync(pidPath)) return undefined;
  const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
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

async function stopServerIfRunning(config: UpdateConfig): Promise<boolean> {
  const pid = readPid(config.dataDir);
  if (!pid || !isProcessRunning(pid)) return false;
  console.log(`Stopping running Echo App Server PID ${pid}...`);
  process.kill(pid, 'SIGTERM');
  for (let index = 0; index < 40; index += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    if (!isProcessRunning(pid)) return true;
  }
  throw new Error('Server did not stop cleanly. Stop it manually, then run echo-server update again.');
}

function startServerDetached(): void {
  const entry = resolve(process.cwd(), 'dist', 'index.js');
  if (!existsSync(entry)) return;
  const child = spawn(process.execPath, [entry], { cwd: process.cwd(), detached: true, stdio: 'ignore', env: process.env });
  child.unref();
}

function runDoctorBestEffort(): void {
  const cli = resolve(process.cwd(), 'dist', 'cli', 'index.js');
  if (!existsSync(cli)) return;
  try {
    execFileSync(process.execPath, [cli, 'doctor'], { stdio: 'inherit' });
  } catch (error) {
    throw new Error('Update applied, but doctor reported a problem. Run echo-server update --rollback if needed.');
  }
}

function applyPackage(packageRoot: string): void {
  copyProject(packageRoot, process.cwd());
  runNpmInstallAndBuild();
}

export async function runUpdateCommand(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const config = loadUpdateConfig(options);

  if (options.rollback) {
    const backup = latestBackup(config);
    if (!backup) throw new Error('No update backup found to roll back.');
    console.log(`Rolling back Echo App Server from: ${backup}`);
    await stopServerIfRunning(config);
    applyPackage(backup);
    if (existsSync(join(backup, '.env'))) cpSync(join(backup, '.env'), envPath, { force: true });
    startServerDetached();
    runDoctorBestEffort();
    console.log('Rollback complete.');
    return;
  }

  console.log('Echo App Server update');
  console.log(`  Current version: ${getPackageVersion()}`);
  console.log(`  Repo:            ${config.repo}`);
  console.log(`  Channel:         ${config.channel}`);
  console.log(`  Asset pattern:   ${config.assetPattern}`);

  const release = await fetchRelease(config);
  const asset = selectAsset(release, config.assetPattern);
  const latestVersion = release.tag_name.replace(/^v/i, '');
  const currentVersion = getPackageVersion();
  const cmp = compareVersions(latestVersion, currentVersion);

  console.log(`  Latest release:  ${release.tag_name}${release.prerelease ? ' (prerelease)' : ''}`);
  console.log(`  Asset:           ${asset.name}`);

  if (options.checkOnly) {
    console.log(cmp > 0 ? 'Update available.' : 'No newer version detected.');
    return;
  }

  if (options.dryRun) {
    console.log('Dry run only. No files changed.');
    console.log('Planned actions: download asset, create backup, stop server if running, apply files, npm install, build, restart, doctor.');
    return;
  }

  const dirs = ensureUpdateDirs(config);
  const zipPath = join(dirs.downloadsDir, asset.name);
  console.log('Downloading update package...');
  await downloadAsset(asset, config.githubToken, zipPath);

  console.log('Creating backup...');
  const backupPath = createBackup(config);
  console.log(`Backup created: ${backupPath}`);

  const wasRunning = await stopServerIfRunning(config);
  const extractDir = join(dirs.tempDir, `extract-${timestamp()}`);
  console.log('Extracting update package...');
  extractZip(zipPath, extractDir);
  const packageRoot = findPackageRoot(extractDir);

  console.log('Applying update files...');
  applyPackage(packageRoot);

  if (wasRunning) {
    console.log('Restarting Echo App Server...');
    startServerDetached();
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }

  console.log('Running doctor...');
  runDoctorBestEffort();
  console.log('Echo App Server update complete.');
}
