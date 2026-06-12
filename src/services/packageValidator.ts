import { extname, isAbsolute, normalize } from 'node:path';

export type PackageKind = 'zip' | 'echoapp';
export type PackageValidationReport = {
  ok: boolean;
  packageKind: PackageKind;
  fileName: string;
  checkedAt: string;
  warnings: string[];
  errors: string[];
  recommendedManifest: string;
};

export type PackageValidationInput = {
  fileName: string;
  sizeBytes?: number;
  version: string;
  platform: string;
  entrypoint: string;
  installType: 'portable' | 'installer';
};

const supportedPlatforms = new Set(['windows-x64', 'linux-x64']);

function cleanEntrypoint(value: string): string {
  return normalize(value).replace(/^[/\\]+/, '');
}

export function detectPackageKind(fileName: string): PackageKind {
  return extname(fileName).toLowerCase() === '.echoapp' ? 'echoapp' : 'zip';
}

export function validatePackageMetadata(input: PackageValidationInput): PackageValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const extension = extname(input.fileName).toLowerCase();
  const packageKind = detectPackageKind(input.fileName);

  if (!['.zip', '.echoapp'].includes(extension)) errors.push('Package must be a .zip or .echoapp file.');
  if (!input.version.trim()) errors.push('Version is required.');
  if (input.version && !/^[0-9]+\.[0-9]+\.[0-9]+([-.][a-zA-Z0-9.]+)?$/.test(input.version)) warnings.push('Version should use semantic versioning, for example 1.0.0.');
  if (!input.platform.trim()) errors.push('Platform is required.');
  if (!supportedPlatforms.has(input.platform)) warnings.push(`Platform ${input.platform} is not one of the standard Echo platforms: windows-x64, linux-x64.`);
  if (!input.entrypoint.trim()) errors.push('Entrypoint is required.');
  const entrypoint = cleanEntrypoint(input.entrypoint);
  if (isAbsolute(input.entrypoint) || entrypoint.includes('..')) errors.push('Entrypoint must be a relative path inside the package.');
  if (input.installType === 'installer') warnings.push('Installer packages should be used only when portable extraction is not possible.');
  if (input.sizeBytes !== undefined && input.sizeBytes <= 0) errors.push('Package file is empty.');
  if (packageKind === 'zip') warnings.push('Use .echoapp for the official Echo package format. .zip is still accepted for compatibility.');

  return {
    ok: errors.length === 0,
    packageKind,
    fileName: input.fileName,
    checkedAt: new Date().toISOString(),
    warnings,
    errors,
    recommendedManifest: 'echo-app.json at package root with id, name, version, platform, and entrypoint.'
  };
}
