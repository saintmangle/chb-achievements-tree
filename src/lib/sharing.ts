export function encodeAchievement(id: string) {
  return 'a_' + btoa(id).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function decodeAchievement(value: unknown): string | null {
  if (typeof value !== 'string' || !/^a_[A-Za-z0-9_-]{1,62}$/.test(value)) return null;
  try { const id = atob(value.slice(2).replaceAll('-', '+').replaceAll('_', '/')); return /^[a-zA-Z0-9._-]{1,46}$/.test(id) ? id : null; } catch { return null; }
}
export function achievementLink(id: string) {
  // /start also works when the bot has not configured a named/direct Mini App.
  return `https://t.me/chb_achievements_bot?start=${encodeAchievement(id)}`;
}
