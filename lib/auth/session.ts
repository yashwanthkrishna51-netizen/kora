import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { verifyToken, isExpired, type TokenPayload } from "./token";
import type { AnyDb } from "./db-types";

/**
 * Session validation, ported from api/_auth.js#validateToken.
 *
 * Signature → expiry → one database read. That read is not optional and is not
 * cached: it is what makes both revocation and role changes take effect
 * immediately rather than whenever a token happens to expire, up to seven days
 * later.
 */

export type SessionFailure =
  | "missing_secret"
  | "no_token"
  | "bad_signature"
  | "expired"
  | "user_not_found"
  | "revoked"
  | "lookup_failed";

export interface SessionUser {
  id: string;
  username: string;
  /** Display name. Written into activity feeds as `addedBy`. */
  name: string;
  role: string;
  tokenVersion: number;
}

export type SessionResult =
  | { valid: true; user: SessionUser; payload: TokenPayload }
  | { valid: false; reason: SessionFailure };

export function getSecret(): string | null {
  return process.env.INTEGTRACK_SECRET || null;
}

export async function validateSession(
  db: AnyDb,
  token: string | null | undefined,
  now = Date.now(),
): Promise<SessionResult> {
  const secret = getSecret();
  if (!secret) return { valid: false, reason: "missing_secret" };
  if (!token) return { valid: false, reason: "no_token" };

  const payload = verifyToken(token, secret);
  if (!payload) return { valid: false, reason: "bad_signature" };
  if (isExpired(payload, now)) return { valid: false, reason: "expired" };

  let row:
    | { tokenVersion: number; role: string; username: string; name: string }
    | undefined;
  try {
    const rows = await db
      .select({
        tokenVersion: users.tokenVersion,
        role: users.role,
        username: users.username,
        name: users.name,
      })
      .from(users)
      .where(eq(users.id, payload.id))
      .limit(1);
    row = rows[0];
  } catch {
    // Fail CLOSED here, unlike the throttle: this is the access control
    // itself, so a database problem must deny rather than admit.
    return { valid: false, reason: "lookup_failed" };
  }

  if (!row) return { valid: false, reason: "user_not_found" };

  if ((row.tokenVersion ?? 0) !== (payload.tokenVersion ?? 0)) {
    // This is force-logout and password-change revocation working.
    return { valid: false, reason: "revoked" };
  }

  return {
    valid: true,
    payload,
    user: {
      id: payload.id,
      username: row.username,
      name: row.name,
      // ALWAYS the freshly-read role, never the one embedded in the token —
      // a demotion has to bite immediately, not in seven days.
      role: row.role,
      tokenVersion: row.tokenVersion ?? 0,
    },
  };
}

/** Message shown on the login screen after being signed out. */
export function reasonMessage(reason: SessionFailure): string | null {
  switch (reason) {
    case "expired":
      return "Your session expired. Please sign in again.";
    case "revoked":
      return "You were signed out. Please sign in again.";
    case "user_not_found":
      return "Your account is no longer active.";
    case "missing_secret":
    case "lookup_failed":
      return "Sign-in is temporarily unavailable. Please try again.";
    default:
      return null;
  }
}
