export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  const normalized = normalizeUsername(username);
  if (normalized.length < 3 || normalized.length > 32) return 'Username must be 3 to 32 characters.';
  if (!/^[a-z0-9_-]+$/.test(normalized)) return 'Username can use letters, numbers, underscore, and dash.';
  return null;
}
