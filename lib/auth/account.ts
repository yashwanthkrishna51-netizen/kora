import { eq, sql, isNotNull } from "drizzle-orm";
import { users, loginIpThrottle } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit";
import { clearAllIpLocks } from "./throttle";
import { signToken, buildPayload } from "./token";
import { verifyPassword, hashPassword, assertPassword } from "./password";
import { clearedState } from "./lockout";
import type { AnyDb } from "./db-types";
import { badRequest, notFound, unauthorized } from "@/lib/api/errors";

/**
 * Account operations, ported from api/account.js.
 *
 * Kept as functions over a database handle rather than inside the routes, so
 * the parts that are easy to get subtly wrong — token rotation, the last-admin
 * implications of a mass logout — are exercised by integration tests.
 */

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword?: string;
  email?: string;
  ip: string | null;
  userAgent: string | null;
}

export interface ChangePasswordResult {
  token: string;
  user: { id: string; username: string; name: string; email: string; role: string };
  passwordChanged: boolean;
}

/**
 * Change password and/or email.
 *
 * Rotating `token_version` invalidates every token for this user, which is the
 * point: changing a password should end sessions elsewhere. But it would also
 * end THIS one, so a freshly signed token is returned and the route re-sets the
 * cookie. Without that, changing your password logs you out immediately and
 * reads as a bug rather than a security feature.
 */
export async function changePassword(
  db: AnyDb,
  input: ChangePasswordInput,
  now = Date.now(),
): Promise<ChangePasswordResult> {
  const secret = process.env.INTEGTRACK_SECRET;
  if (!secret) throw new Error("INTEGTRACK_SECRET is not set");

  if (input.newPassword !== undefined) assertPassword(input.newPassword);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user) throw notFound("User not found");

  const { ok } = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw unauthorized("Current password is incorrect");

  const passwordChanged = Boolean(input.newPassword);
  const nextTokenVersion = passwordChanged
    ? (user.tokenVersion ?? 0) + 1
    : (user.tokenVersion ?? 0);

  const nextEmail =
    typeof input.email === "string" ? input.email.trim() : (user.email ?? "");

  const update: Record<string, unknown> = {};
  if (typeof input.email === "string") update.email = nextEmail;
  if (passwordChanged) {
    update.passwordHash = await hashPassword(input.newPassword!);
    update.tokenVersion = nextTokenVersion;
  }

  if (Object.keys(update).length > 0) {
    await db.update(users).set(update).where(eq(users.id, user.id));
  }

  await logAudit(db, {
    actorId: user.id,
    username: user.username,
    role: user.role,
    action: passwordChanged
      ? "Password changed (self-service)"
      : "Profile updated (self-service)",
    entity: "users",
    screen: "my-profile",
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const token = signToken(
    buildPayload(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: nextTokenVersion,
      },
      now,
    ),
    secret,
  );

  return {
    token,
    passwordChanged,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      email: nextEmail,
      role: user.role,
    },
  };
}

/**
 * Invalidate every session in the system.
 *
 * One statement. The old app read every user and issued a PATCH per row,
 * because PostgREST cannot express `column = column + 1` — a limitation of the
 * transport, not of the problem. With SQL it is a single atomic update, so
 * there is no window in which half the users are signed out.
 *
 * This signs the caller out too. That is deliberate and matches the old
 * behaviour: its real use is the cutover freeze, where the point is that
 * nobody — including the admin — keeps writing.
 */
export async function forceLogoutAll(
  db: AnyDb,
  actor: { id: string; username: string; role: string },
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ affected: number }> {
  const rows = await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .returning({ id: users.id });

  await logAudit(db, {
    actorId: actor.id,
    username: actor.username,
    role: actor.role,
    action: `Force logout: all users (${rows.length})`,
    entity: "session",
    screen: "admin",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { affected: rows.length };
}

export async function forceLogoutUser(
  db: AnyDb,
  userId: string,
  actor: { id: string; username: string; role: string },
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ affected: number; username: string }> {
  const rows = await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId))
    .returning({ username: users.username });

  if (!rows.length) throw notFound("User not found");

  await logAudit(db, {
    actorId: actor.id,
    username: actor.username,
    role: actor.role,
    action: `Force logout: ${rows[0].username}`,
    entity: "session",
    screen: "admin",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { affected: 1, username: rows[0].username };
}

export interface ClearLockoutResult {
  username: string;
  /** How many addresses are currently locked by the per-IP throttle. */
  networkLocksActive: number;
  networkLocksCleared: number;
}

/**
 * Release an account locked by repeated failed logins.
 *
 * There are TWO independent locks and the old button only cleared one. An
 * admin would clear the account, the person would try again, and still be
 * refused — this time by the per-IP throttle, with nothing anywhere saying so.
 *
 * Clearing every IP lock automatically would be the wrong fix: those rows are
 * also the evidence of an attack in progress, and one user's forgotten password
 * should not wipe them. So the count is reported, and clearing is opt-in.
 */
export async function clearLockout(
  db: AnyDb,
  userId: string,
  actor: { id: string; username: string; role: string },
  meta: { ip: string | null; userAgent: string | null },
  opts: { clearNetworkLocks?: boolean } = {},
  now = Date.now(),
): Promise<ClearLockoutResult> {
  const cleared = clearedState();

  const rows = await db
    .update(users)
    .set({
      failedAttempts: cleared.failed_attempts,
      lockoutLevel: cleared.lockout_level,
      lockedUntil: cleared.locked_until,
    })
    .where(eq(users.id, userId))
    .returning({ username: users.username });

  if (!rows.length) throw notFound("User not found");

  // Count only locks that have not already expired on their own.
  const active = await db
    .select({ ip: loginIpThrottle.ip, lockedUntil: loginIpThrottle.lockedUntil })
    .from(loginIpThrottle)
    .where(isNotNull(loginIpThrottle.lockedUntil));

  const stillLocked = active.filter(
    (r) => r.lockedUntil && new Date(r.lockedUntil).getTime() > now,
  );

  // clearAllIpLocks rather than repeating its DELETE here: the same statement
  // written twice is the same statement free to drift, and this one decides
  // whether somebody can log in.
  const networkLocksCleared =
    opts.clearNetworkLocks && stillLocked.length
      ? await clearAllIpLocks(db)
      : 0;

  await logAudit(db, {
    actorId: actor.id,
    username: actor.username,
    role: actor.role,
    action:
      `Clear lockout: ${rows[0].username}` +
      (networkLocksCleared ? ` (+${networkLocksCleared} network locks)` : ""),
    entity: "users",
    screen: "admin",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return {
    username: rows[0].username,
    networkLocksActive: stillLocked.length,
    networkLocksCleared,
  };
}

/** Shared by the routes that take a user id in the path. */
export function assertUserId(id: unknown): string {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw badRequest("Invalid user id");
  }
  return id;
}
