import { eq, sql } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit";
import { signToken, buildPayload } from "./token";
import {
  verifyPassword,
  hashPassword,
  burnPasswordTime,
} from "./password";
import {
  checkLocked,
  registerFailure,
  clearedState,
  lockoutMessage,
} from "./lockout";
import {
  checkIpThrottle,
  recordIpFailure,
  throttleMessage,
} from "./throttle";
import type { AnyDb } from "./db-types";

/**
 * The login flow, ported from api/login.js.
 *
 * Kept as a plain function taking a database handle rather than living inside
 * the route, so the whole thing — lockout escalation, lazy rehash, throttle —
 * is exercised by integration tests against a real Postgres instead of only
 * ever running for the first time in production.
 *
 * ORDER MATTERS and is preserved:
 *   1. IP throttle, BEFORE any lookup or bcrypt work, so a throttled address
 *      costs a row read rather than a full password verification.
 *   2. Unknown username still performs a bcrypt comparison against a dummy
 *      hash, so response time does not reveal whether an account exists.
 *   3. Lockout is checked before the password, so a locked account cannot be
 *      probed for password correctness.
 */

export interface LoginInput {
  username: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

export interface LoginUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
}

export type LoginResult =
  | { ok: true; token: string; user: LoginUser }
  | {
      ok: false;
      status: 401 | 423 | 429 | 500;
      error: string;
      lockedUntil?: string;
    };

const GENERIC = "Invalid username or password";

export async function attemptLogin(
  db: AnyDb,
  input: LoginInput,
  now = Date.now(),
): Promise<LoginResult> {
  const secret = process.env.INTEGTRACK_SECRET;
  if (!secret) {
    return { ok: false, status: 500, error: "Server misconfigured" };
  }

  const { username, password, ip, userAgent } = input;

  // 1. IP axis first — cheap rejection before any real work.
  const throttle = await checkIpThrottle(db, ip, now);
  if (throttle.locked) {
    return {
      ok: false,
      status: 429,
      error: throttleMessage(throttle.remainingMin),
    };
  }

  // Case-insensitive lookup. The old app used an exact match, so someone who
  // capitalised their username simply could not log in and had no way to tell
  // why. Backed by the unique index from migration 0005.
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);

  const user = rows[0];

  if (!user) {
    // 2. Timing equalisation — without this, an unknown username returns
    // measurably faster than a wrong password and the 401 becomes an oracle.
    await burnPasswordTime(password);
    await logAudit(db, {
      username,
      action: "Login failed: unknown user",
      entity: "session",
      screen: "login",
      ip,
      userAgent,
    });
    await recordIpFailure(db, ip, throttle.row, now);
    return { ok: false, status: 401, error: GENERIC };
  }

  // 3. Lockout before password, so a locked account reveals nothing further.
  const locked = checkLocked({ lockedUntil: user.lockedUntil ?? null }, now);
  if (locked.locked) {
    await logAudit(db, {
      username: user.username,
      action: `Login failed: locked out (${locked.remainingMin}min left)`,
      entity: "session",
      screen: "login",
      ip,
      userAgent,
    });
    await recordIpFailure(db, ip, throttle.row, now);
    return {
      ok: false,
      status: 423,
      error: lockoutMessage(locked.remainingMin),
      lockedUntil: locked.lockedUntil ?? undefined,
    };
  }

  const { ok: passwordOk, needsRehash } = await verifyPassword(
    password,
    user.passwordHash,
  );

  if (!passwordOk) {
    const update = registerFailure(
      {
        failedAttempts: user.failedAttempts ?? 0,
        lockoutLevel: user.lockoutLevel ?? 0,
      },
      now,
    );
    await db
      .update(users)
      .set({
        failedAttempts: update.failed_attempts,
        ...(update.lockout_level !== undefined
          ? { lockoutLevel: update.lockout_level }
          : {}),
        ...(update.locked_until !== undefined
          ? { lockedUntil: update.locked_until }
          : {}),
      })
      .where(eq(users.id, user.id));

    await logAudit(db, {
      username: user.username,
      action: "Login failed: wrong password",
      entity: "session",
      screen: "login",
      ip,
      userAgent,
    });
    await recordIpFailure(db, ip, throttle.row, now);
    return { ok: false, status: 401, error: GENERIC };
  }

  // Success: clear both counters, and upgrade a legacy hash while we have the
  // plaintext in hand — the only moment it is available.
  //
  // ONLY WHEN SOMETHING WOULD ACTUALLY CHANGE. This used to run on every
  // successful login, which was a wasted write for the overwhelmingly common
  // case of someone signing in cleanly — and, since migration 0006, a harmful
  // one: the `set_updated_at` trigger fires on any UPDATE, so `updated_at`
  // moved on every sign-in, and `updated_at` is the OCC token.
  //
  // That made every user row's `_v` change whenever that person signed in
  // anywhere. An admin with the users table open would then get a 409 —
  // "someone else changed this while you were editing" — on a role change or a
  // delete, naming a conflict that never happened. Caught by `verify:admin`,
  // which drives a real login between reading a token and using it.
  const cleared = clearedState();
  const lockoutDirty =
    (user.failedAttempts ?? 0) !== cleared.failed_attempts ||
    (user.lockoutLevel ?? 0) !== cleared.lockout_level ||
    user.lockedUntil !== cleared.locked_until;

  if (lockoutDirty || needsRehash) {
    await db
      .update(users)
      .set({
        ...(lockoutDirty
          ? {
              failedAttempts: cleared.failed_attempts,
              lockoutLevel: cleared.lockout_level,
              lockedUntil: cleared.locked_until,
            }
          : {}),
        ...(needsRehash ? { passwordHash: await hashPassword(password) } : {}),
      })
      .where(eq(users.id, user.id));
  }

  const token = signToken(
    buildPayload(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.tokenVersion ?? 0,
      },
      now,
    ),
    secret,
  );

  await logAudit(db, {
    actorId: user.id,
    username: user.username,
    role: user.role,
    action: "Login success",
    entity: "session",
    screen: "login",
    ip,
    userAgent,
  });

  return {
    ok: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email ?? "",
      role: user.role,
    },
  };
}

/**
 * Issues a session for a user who has already proven who they are.
 *
 * Shared by the password path above and the Microsoft SSO callback, so the two
 * cannot drift on what signing in means. That matters most for the lockout
 * counters: clearing them here means an SSO sign-in releases a username
 * lockout exactly as a password sign-in does.
 *
 * SSO deliberately does NOT check `locked_until` before calling this. Lockout
 * exists to stop password guessing, and somebody who has just cleared Entra —
 * with MFA, most likely — has proven identity by a stronger factor than the
 * one being throttled. Blocking them would also hand an attacker a way to deny
 * a colleague their SSO login simply by burning failed password attempts
 * against their username.
 */
export async function issueSession(
  db: AnyDb,
  user: { id: string; username: string; name: string; email?: string | null; role: string; tokenVersion?: number },
  ctx: { ip?: string | null; userAgent?: string | null; action: string; screen?: string },
  now = Date.now(),
): Promise<{ token: string; user: { id: string; username: string; name: string; email: string; role: string } }> {
  const secret = process.env.INTEGTRACK_SECRET;
  if (!secret) throw new Error("INTEGTRACK_SECRET is not set");

  const cleared = clearedState();
  await db
    .update(users)
    .set({
      failedAttempts: cleared.failed_attempts,
      lockoutLevel: cleared.lockout_level,
      lockedUntil: cleared.locked_until,
    })
    .where(eq(users.id, user.id));

  const token = signToken(
    buildPayload(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.tokenVersion ?? 0,
      },
      now,
    ),
    secret,
  );

  await logAudit(db, {
    actorId: user.id,
    username: user.username,
    role: user.role,
    action: ctx.action,
    entity: "session",
    screen: ctx.screen ?? "login",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email ?? "",
      role: user.role,
    },
  };
}
