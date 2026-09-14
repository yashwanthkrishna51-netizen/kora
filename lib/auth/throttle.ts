import { eq, sql } from "drizzle-orm";
import { loginIpThrottle } from "@/lib/db/schema";
import type { AnyDb } from "./db-types";

/**
 * Per-IP login throttle, ported from api/_throttle.js.
 *
 * A second, independent axis from the per-username lockout. Username lockout
 * alone is abusable in reverse: five deliberate failures against each known
 * username locks out the whole company, admins included. This makes that
 * expensive without requiring any knowledge of who exists.
 *
 * FAILS OPEN by design. This is defence in depth, not the access control
 * itself, so a database hiccup must never become the reason a legitimate
 * person cannot log in.
 */

export const WINDOW_MINUTES = 15;
export const MAX_ATTEMPTS_PER_WINDOW = 20;
export const LOCK_MINUTES = 15;

export interface ThrottleRow {
  ip: string;
  attemptCount: number;
  windowStart: string | null;
  lockedUntil: string | null;
}

export interface ThrottleCheck {
  locked: boolean;
  remainingMin: number;
  row: ThrottleRow | null;
}

/**
 * The next row state after a failure. Pure, so the window arithmetic is
 * testable without a database.
 *
 * Once the limit is hit the counter resets and the window restarts alongside
 * the lock, so the next window begins clean when the lock expires.
 */
export function nextThrottleState(
  row: Pick<ThrottleRow, "attemptCount" | "windowStart"> | null,
  now = Date.now(),
): { attemptCount: number; windowStart: string; lockedUntil: string | null } {
  const windowMs = WINDOW_MINUTES * 60000;
  const prevStart = row?.windowStart ? new Date(row.windowStart).getTime() : NaN;
  const withinWindow = !Number.isNaN(prevStart) && now - prevStart < windowMs;

  const attemptCount = withinWindow ? (row?.attemptCount ?? 0) + 1 : 1;
  const windowStart = withinWindow
    ? new Date(prevStart).toISOString()
    : new Date(now).toISOString();

  if (attemptCount >= MAX_ATTEMPTS_PER_WINDOW) {
    return {
      attemptCount: 0,
      windowStart: new Date(now).toISOString(),
      lockedUntil: new Date(now + LOCK_MINUTES * 60000).toISOString(),
    };
  }

  return { attemptCount, windowStart, lockedUntil: null };
}

/**
 * Called BEFORE any user lookup or bcrypt work, so a throttled address gets a
 * cheap rejection rather than costing a full verification every time.
 */
export async function checkIpThrottle(
  db: AnyDb,
  ip: string | null,
  now = Date.now(),
): Promise<ThrottleCheck> {
  if (!ip) return { locked: false, remainingMin: 0, row: null };

  try {
    const rows = await db
      .select()
      .from(loginIpThrottle)
      .where(eq(loginIpThrottle.ip, ip))
      .limit(1);

    const r = rows[0];
    if (!r) return { locked: false, remainingMin: 0, row: null };

    const row: ThrottleRow = {
      ip: r.ip,
      attemptCount: r.attemptCount ?? 0,
      windowStart: r.windowStart ?? null,
      lockedUntil: r.lockedUntil ?? null,
    };

    if (row.lockedUntil) {
      const until = new Date(row.lockedUntil).getTime();
      if (!Number.isNaN(until) && until > now) {
        return {
          locked: true,
          remainingMin: Math.ceil((until - now) / 60000),
          row,
        };
      }
    }
    return { locked: false, remainingMin: 0, row };
  } catch {
    // Fail open — see the note at the top.
    return { locked: false, remainingMin: 0, row: null };
  }
}

/** Called on every failed attempt, never on success. */
export async function recordIpFailure(
  db: AnyDb,
  ip: string | null,
  row: ThrottleRow | null,
  now = Date.now(),
): Promise<void> {
  if (!ip) return;

  const next = nextThrottleState(row, now);
  const stamp = new Date(now).toISOString();

  try {
    await db
      .insert(loginIpThrottle)
      .values({
        ip,
        attemptCount: next.attemptCount,
        windowStart: next.windowStart,
        lockedUntil: next.lockedUntil,
        updatedAt: stamp,
      })
      .onConflictDoUpdate({
        target: loginIpThrottle.ip,
        set: {
          attemptCount: next.attemptCount,
          windowStart: next.windowStart,
          lockedUntil: next.lockedUntil,
          updatedAt: stamp,
        },
      });
  } catch {
    // Throttle bookkeeping must never break the login response itself.
  }
}

/**
 * Clears the IP lock for an address.
 *
 * The old app's "Clear Lockout" only reset the username axis, so an admin
 * could unlock the account and the person would still be blocked by their
 * network — with no indication why. Clearing both is what makes that button
 * actually mean what it says.
 */
export async function clearIpThrottle(db: AnyDb, ip: string): Promise<void> {
  try {
    await db.delete(loginIpThrottle).where(eq(loginIpThrottle.ip, ip));
  } catch {
    /* best effort */
  }
}

/** Clears every currently-locked address; used by admin clear-lockout. */
export async function clearAllIpLocks(db: AnyDb): Promise<number> {
  try {
    const res = await db
      .delete(loginIpThrottle)
      .where(sql`${loginIpThrottle.lockedUntil} is not null`)
      .returning({ ip: loginIpThrottle.ip });
    return res.length;
  } catch {
    return 0;
  }
}

export function throttleMessage(remainingMin: number): string {
  return `Too many attempts from your network. Try again in ${remainingMin} minute${
    remainingMin === 1 ? "" : "s"
  }.`;
}
