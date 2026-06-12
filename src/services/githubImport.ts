import type { ReleaseChannel } from '../types.js';

export type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

export type GitHubReleaseInfo = {
  tagName: string;
  name: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
  publishedAt?: string;
  assets: GitHubReleaseAsset[];
};

function githubHeaders(token?: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Echo-App-Server',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function mapRelease(data: any): GitHubReleaseInfo {
  return {
    tagName: data.tag_name,
    name: data.name ?? data.tag_name,
    body: data.body ?? '',
    prerelease: Boolean(data.prerelease),
    draft: Boolean(data.draft),
    publishedAt: data.published_at ?? undefined,
    assets: (data.assets ?? []).map((asset: any) => ({
      name: asset.name,
      browser_download_url: asset.browser_download_url,
      size: asset.size,
    })),
  };
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .split('')
    .map((char) => {
      if (char === '*') return '.*';
      if (char === '?') return '.';
      return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${escaped}$`, 'i');
}

export function selectGitHubAsset(release: GitHubReleaseInfo, assetPattern?: string): GitHubReleaseAsset | undefined {
  const assets = release.assets.filter((asset) => asset.name.toLowerCase().endsWith('.zip') || asset.name.toLowerCase().endsWith('.echoapp'));
  if (!assets.length) return release.assets[0];
  if (!assetPattern || !assetPattern.trim()) return assets[0];
  const matcher = wildcardToRegExp(assetPattern);
  return assets.find((asset) => matcher.test(asset.name)) ?? assets.find((asset) => asset.name.toLowerCase().includes(assetPattern.toLowerCase().replace(/[*?]/g, ''))) ?? assets[0];
}

export async function fetchGitHubRelease(input: {
  owner: string;
  repo: string;
  tag: string;
  token?: string;
}): Promise<GitHubReleaseInfo> {
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/releases/tags/${encodeURIComponent(input.tag)}`;
  const data = await githubJson<any>(url, input.token);
  return mapRelease(data);
}

export async function fetchLatestGitHubRelease(input: {
  owner: string;
  repo: string;
  channel?: ReleaseChannel;
  includePrereleases?: boolean;
  token?: string;
}): Promise<GitHubReleaseInfo> {
  const channel = input.channel ?? 'stable';
  if (channel === 'stable' && !input.includePrereleases) {
    const data = await githubJson<any>(`https://api.github.com/repos/${input.owner}/${input.repo}/releases/latest`, input.token);
    return mapRelease(data);
  }
  const releases = await githubJson<any[]>(`https://api.github.com/repos/${input.owner}/${input.repo}/releases?per_page=30`, input.token);
  const visible = releases.map(mapRelease).filter((release) => !release.draft && (input.includePrereleases || channel !== 'stable' || !release.prerelease));
  const selected = visible[0];
  if (!selected) throw new Error('GitHub repository has no matching releases.');
  return selected;
}

export function versionFromTag(tag: string): string {
  return tag.replace(/^v/i, '');
}
