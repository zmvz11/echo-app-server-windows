export type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

export type GitHubReleaseInfo = {
  tagName: string;
  name: string;
  body: string;
  assets: GitHubReleaseAsset[];
};

export async function fetchGitHubRelease(input: {
  owner: string;
  repo: string;
  tag: string;
  token?: string;
}): Promise<GitHubReleaseInfo> {
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/releases/tags/${input.tag}`;
  const response = await fetch(url, {
    headers: input.token ? { Authorization: `Bearer ${input.token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`GitHub release import failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  return {
    tagName: data.tag_name,
    name: data.name ?? data.tag_name,
    body: data.body ?? '',
    assets: (data.assets ?? []).map((asset: any) => ({
      name: asset.name,
      browser_download_url: asset.browser_download_url,
      size: asset.size,
    })),
  };
}
