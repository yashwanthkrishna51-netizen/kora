/**
 * Per-username lockout, ported from api/login.js.
 *
 * Five consecutive failures locks the account, escalating 30 min → 4 h → 24 h
 * and staying at 24 h thereafter. The counter resets on any successful login.
 *
 * Note this is only one of two axes. On its own it is abusable: an attacker
 * who knows the usernames can lock out every account — including every admin —
 * simply by failing five times against each. The per-IP throttle in
 * ./throttle.ts is what makes that expensive, which is why both exist.
 *
 * Pure functions; the caller owns the database.
 */

export const MAX_ATTEMPTS_BEFORE_LOCK = 5;
/** Minutes per escalation step; the last value repeats. */
export const LOCKOUT_MINUTES = [30, 240, 1440] as const;

export interface LockoutState {
  failedAttempts: number;
  lockoutLevel: number;
  lockedUntil: string | null;
}

export interface LockoutUpdate {
  failed_attempts: number;
  lockout_level?: number;
  locked_until?: string | null;
}

/** Whether the account is currently locked, and for how much longer. */
export function checkLocked(
  state: Pick<LockoutState, "lockedUntil">,
  now = Date.now(),
): { locked: boolean; remainingMin: number; lockedUntil: string | null } {
  if (!state.lockedUntil) {
    return { locked: false, remainingMin: 0, lockedUntil: null };
  }
  const until = new Date(state.lockedUntil).getTime();
  if (Number.isNaN(until) || until <= now) {
    return { locked: false, remainingMin: 0, lockedUntil: state.lockedUntil };
  }
  return {
    locked: true,
    remainingMin: Math.ceil((until - now) / 60000),
    lockedUntil: state.lockedUntil,
  };
}

/**
 * The row update to apply after a failed attempt.
 *
 * On the fifth failure the counter resets to zero and the level advances, so
 * the next lock is longer — the level, not the counter, is what escalates.
 */
export function registerFailure(
  state: Pick<LockoutState, "failedAttempts" | "lockoutLevel">,
  now = Date.now(),
): LockoutUpdate {
  const attempts = (state.failedAttempts || 0) + 1;

  if (attempts < MAX_ATTEMPTS_BEFORE_LOCK) {
    return { failed_attempts: attempts };
  }

  const level = state.lockoutLevel || 0;
  const minutes = LOCKOUT_MINUTES[Math.min(level, LOCKOUT_MINUTES.length - 1)];

  return {
    failed_attempts: 0,
    lockout_level: level + 1,
    locked_until: new Date(now + minutes * 60000).toISOString(),
  };
}

/** Cleared on success, so a user who eventually logs in starts fresh. */
export function clearedState(): Required<LockoutUpdate> {
  return { failed_attempts: 0, lockout_level: 0, locked_until: null };
}

export function lockoutMessage(remainingMin: number): string {
  return `Too many failed attempts. Try again in ${remainingMin} minute${
    remainingMin === 1 ? "" : "s"
  }.`;
}
