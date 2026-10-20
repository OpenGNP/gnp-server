/**
 * Failed password sign-ins per email, in memory: after MAX_FAILURES within WINDOW_MS
 * that email is locked until the window passes. Keyed by email, not IP (behind the
 * proxies every request may share one); a lockout only blocks the password route,
 * Microsoft sign-in still works.
 */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, { count: number; since: number }>();

const keyOf = (email: string) => email.trim().toLowerCase();

/** Minutes until `email` may try again, or 0 if it isn't locked. */
export function lockedForMinutes(email: string, now = Date.now()): number {
  const entry = failures.get(keyOf(email));
  if (!entry) return 0;
  if (now - entry.since >= WINDOW_MS) {
    failures.delete(keyOf(email));
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.since + WINDOW_MS - now) / 60_000) : 0;
}

export function recordLoginFailure(email: string, now = Date.now()) {
  const key = keyOf(email);
  const entry = failures.get(key);
  if (!entry || now - entry.since >= WINDOW_MS) failures.set(key, { count: 1, since: now });
  else entry.count++;
}

export function clearLoginFailures(email: string) {
  failures.delete(keyOf(email));
}
