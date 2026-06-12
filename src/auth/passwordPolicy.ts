export function validatePassword(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters.';
  if (password.length > 128) return 'Password must be 128 characters or fewer.';
  return null;
}
