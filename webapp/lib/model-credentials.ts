// Credentials deliberately live outside the book database and exports.
const SESSION_KEY = "momai-deepseek-session-key";
export function readSessionKey(): string {
  try { return sessionStorage.getItem(SESSION_KEY) ?? ""; } catch { return ""; }
}
export function saveSessionKey(value: string): void {
  if (value) sessionStorage.setItem(SESSION_KEY, value); else sessionStorage.removeItem(SESSION_KEY);
}
export function validApiKey(value: string): boolean { return /^[\x21-\x7e]{10,256}$/.test(value); }
