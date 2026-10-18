const KEY = 'trailbound.session';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Call right after a successful sign-in or sign-up. 1 day, or 7 days with "Remember me". */
export function startSession(remember: boolean): void {
  const ttl = remember ? 7 * DAY_MS : DAY_MS;
  try {
    localStorage.setItem(KEY, JSON.stringify({ expiresAt: Date.now() + ttl, remember }));
  } catch {
    /* storage unavailable: the session will be treated as expired on next check */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** True if there is no record, or the recorded time has passed. */
export function isSessionExpired(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return true;
    return Date.now() >= JSON.parse(raw).expiresAt;
  } catch {
    return true;
  }
}
