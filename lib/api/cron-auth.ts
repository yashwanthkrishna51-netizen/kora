import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { AppError, unauthorized } from "./errors";
import { readSessionCookie } from "@/lib/auth/cookies";
import { validateSession, type SessionUser } from "@/lib/auth/session";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Authentication for scheduled jobs.
 *
 * The old app's backup cron wrapped its ENTIRE auth check in
 * `if (CRON_SECRET) { ... }` (api/cron/backup.js:94). With the variable unset —
 * a fresh environment, a typo, a deleted variable — the endpoint was completely
 * unauthenticated, and it dumps every client and every user row, password
 * hashes included, to storage. A missing secret produced no error and no log
 * line; it just quietly turned the lock off.
 *
 * So this fails CLOSED. No secret configured is a 503, decided before any
 * database work, because "we cannot check who you are" is a server fault and
 * must never resolve to "come in".
 */

export type CronCaller =
  | { kind: "cron" }
  | { kind: "admin"; user: SessionUser };

/**
 * Constant-time comparison of two secrets of unknown length.
 *
 * Both sides are hashed first. `timingSafeEqual` throws a RangeError on
 * unequal lengths, and here the attacker controls the length of one side
 * entirely — so comparing raw strings hands them a way to turn a guess into a
 * 500 and, worse, to learn the secret's length from which inputs crash. SHA-256
 * makes both operands exactly 32 bytes by construction, so there is no length
 * check to forget. Same failure class as the hex pre-check in token.ts.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Two ways in, both explicit.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically once the
 * variable is set on the project. It also sends `x-vercel-cron: 1`, which is
 * NOT authenticated — any caller can set that header, so it is never accepted
 * as evidence of anything.
 *
 * The admin path is carried over deliberately: it is what makes "run the digest
 * now" possible from the admin screen without a second endpoint and a second
 * set of guards.
 */
export async function requireCronAuth(
  req: NextRequest,
  db: AnyDb,
): Promise<CronCaller> {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    throw new AppError(
      503,
      "Scheduled jobs are not configured on this server.",
      { code: "cron_not_configured" },
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (bearer && secretMatches(bearer, expected)) {
    return { kind: "cron" };
  }

  // Falls through to the admin path rather than rejecting outright, so a
  // signed-in admin triggering a run manually is not required to know the
  // cron secret.
  //
  // Wrapped because `cookies()` throws when there is no request scope to read
  // from. That must resolve to "not authenticated", not to an unhandled error:
  // this is an authorisation decision, and the only safe direction for one to
  // fail is closed.
  try {
    const token = await readSessionCookie();
    if (token) {
      const session = await validateSession(db, token);
      if (session.valid && session.user.role === "admin") {
        return { kind: "admin", user: session.user };
      }
    }
  } catch {
    // Fall through to the 401 below.
  }

  throw unauthorized("This endpoint is for scheduled jobs.");
}

/** Audit attribution for whichever path got in. */
export function cronActor(caller: CronCaller, job: string) {
  return caller.kind === "cron"
    ? { actorId: null, username: null, role: null, action: `${job} (scheduled)` }
    : {
        actorId: caller.user.id,
        username: caller.user.username,
        role: caller.user.role,
        action: `${job} (run manually)`,
      };
}
