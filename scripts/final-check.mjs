import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const steps = [
  ['lint', 'npm run lint'],
  ['typecheck', 'npm run typecheck'],
  ['build', 'npm run build']
];

for (const [name, command] of steps) {
  console.log(`Running ${name}...`);
  execSync(command, { stdio: 'inherit', shell: true });
}

const packageLock = existsSync('package-lock.json') ? readFileSync('package-lock.json', 'utf8') : '';
const forbiddenRegistryMarkers = ['applied-' + 'caas', 'internal.api.' + 'openai.org'];
if (forbiddenRegistryMarkers.some((marker) => packageLock.includes(marker))) {
  throw new Error('package-lock.json contains internal registry URLs.');
}

const requiredServerFiles = [
  'src/cli/serverCommands.ts',
  'src/cli/index.ts',
  'src/routes/setup.ts',
  'src/routes/auth.ts',
  'src/routes/apps.ts',
  'src/routes/releases.ts',
  'src/routes/clients.ts',
  '.env.example',
  'README.md',
  'docs/INSTALL.md'
];
for (const file of requiredServerFiles) {
  if (!existsSync(file)) throw new Error(`Missing required server file: ${file}`);
}

if (!existsSync('dist/cli/index.js')) throw new Error('Missing built CLI: dist/cli/index.js');
if (!existsSync('src/cli/index.ts')) throw new Error('Missing CLI source: src/cli/index.ts');
console.log('Echo App Server final check passed.');
