import { sql } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * The never-provision gate.
 *
 * SSO signs people in; it never creates them. A valid Microsoft identity with
 * no matching Kora account is refused at the door — that is the entire point
 * of the feature, and it is what stops anyone in the tenant granting
 * themselves access by clicking a button.
 *
 * Matching is by EMAIL, against `users.email`. Not by username, not by Entra
 * object id — the old app matched on email and the stored data has nothing
 * else to match on.
 */

export type GateResult =
  | { ok: true; user: GateUser }
  | {
      ok: false;
      code:
        | "not_authorized"
        | "sso_ambiguous"
        | "lookup_failed"
        | "domain_not_allowed";
    };

/**
 * Optional second gate: the Entra account's email must sit at an allowed domain.
 *
 * Strictly speaking this is redundant — the check below already requires a
 * matching row in `users`, so an outside account cannot get in regardless. It
 * earns its place as the guard against the mistake ONE LEVEL UP: an admin
 * adding a contractor or a client contact to the users table, at which point
 * that person can sign in with their own Microsoft account and the
 * never-provision gate happily lets them.
 *
 * Comma-separated, so a second domain after an acquisition is a config change.
 * Unset means no domain restriction, which is the correct default for anyone
 * who has not thought about it.
 */
export function allowedDomains(): string[] {
  return (process.env.AZURE_ALLOWED_DOMAIN ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function domainAllowed(email: string): boolean {
  const allowed = allowedDomains();
  if (!allowed.length) return true;
  // Last "@" wins: an address may legitimately contain one in a quoted local
  // part, and taking the first would compare against the wrong thing.
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  // Exact match only. Suffix matching would let `notkognozconsulting.com`
  // through, which is precisely the trick this is meant to stop.
  return allowed.includes(domain);
}

export interface GateUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  tokenVersion: number;
}

export async function resolveSsoUser(
  db: AnyDb,
  email: string,
): Promise<GateResult> {
  const candidate = email.trim();
  if (!candidate) return { ok: false, code: "not_authorized" };

  // Before the database is touched: an account from outside the tenant's
  // domain is refused without costing a query.
  if (!domainAllowed(candidate)) return { ok: false, code: "domain_not_allowed" };

  let rows: GateUser[];
  try {
    rows = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        role: users.role,
        tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(
        sql`lower(trim(${users.email})) = lower(trim(${candidate}))
            and ${users.email} <> ''`,
      )
      // TWO, not one. See below.
      .limit(2) as GateUser[];
  } catch (err) {
    // Fail closed: an access-control decision that cannot be made is a denial.
    //
    // But LOG IT. This branch swallowed the error entirely, so a deployment
    // whose DATABASE_URL was wrong showed users "Sign-in is temporarily
    // unavailable" and left no trace of why — diagnosing it needed a probe
    // from outside the app. The person signing in still gets the generic
    // message; the operator gets the cause.
    console.error(
      "SSO gate: user lookup failed —",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, code: "lookup_failed" };
  }

  if (rows.length === 0) return { ok: false, code: "not_authorized" };

  // `users.email` has no unique constraint — schema.ts only declares
  // uq_users_username_ci. The old query took `limit=1` from an unordered
  // result, so two accounts sharing an address meant SSO signed you into
  // whichever row Postgres happened to return first, quite possibly the more
  // privileged one. Refusing is the only safe answer, and it is visible:
  // the person gets a distinct message and an admin has something to fix.
  if (rows.length > 1) return { ok: false, code: "sso_ambiguous" };

  return { ok: true, user: rows[0] };
}
