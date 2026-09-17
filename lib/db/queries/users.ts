import { asc, sql } from "drizzle-orm";
import { vToken } from "@/lib/db/occ";
import { qualify } from "@/lib/db/sql";
import { users, auditLog } from "@/lib/db/schema";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * User reads, shaped by the caller's role.
 *
 * Two shapes exist because everyone needs the name list — assignee dropdowns
 * appear on every domain screen — but only an admin should see lockout state
 * and email addresses.
 *
 * `passwordHash` is never selected. Not filtered afterwards: never selected,
 * so there is no code path where a refactor could let it slip into a response.
 */

export interface UserOption {
  id: string;
  username: string;
  name: string;
  role: string;
}

export interface UserAdminView extends UserOption {
  email: string;
  createdAt: string | null;
  lockedUntil: string | null;
  failedAttempts: number;
  lockoutLevel: number;
  /**
   * Most recent audit row for this username, or null if they have never acted.
   *
   * There is no `last_login` column and adding one would mean a write on every
   * sign-in. The audit log already records every login and every mutation, so
   * it is the honest source — and it means "last active" covers acting, not
   * just authenticating.
   *
   * Matched on `username` because that is what `audit_log` stores. Usernames
   * are immutable (`userUpdate` omits the field), so the join cannot rot.
   */
  lastActive: string | null;
  _v: string | null;
}

export async function listUsersForDropdown(db: AnyDb): Promise<UserOption[]> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .orderBy(asc(users.username));
  return rows;
}

export async function listUsersForAdmin(db: AnyDb): Promise<UserAdminView[]> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      email: users.email,
      createdAt: users.createdAt,
      lockedUntil: users.lockedUntil,
      failedAttempts: users.failedAttempts,
      lockoutLevel: users.lockoutLevel,
      lastActive: sql<string | null>`(
        select max(a.ts) from ${auditLog} a
        where a.username = ${qualify(users.username)})`,
      _v: vToken(users.updatedAt),
    })
    .from(users)
    .orderBy(asc(users.username));

  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    name: r.name,
    role: r.role,
    email: r.email ?? "",
    createdAt: r.createdAt,
    lockedUntil: r.lockedUntil,
    failedAttempts: r.failedAttempts,
    lockoutLevel: r.lockoutLevel,
    lastActive: r.lastActive,
    _v: r._v,
  }));
}

/** Single entry point, so a route cannot pick the wrong shape by accident. */
export async function listUsers(
  db: AnyDb,
  role: string,
): Promise<UserOption[] | UserAdminView[]> {
  return role === "admin" ? listUsersForAdmin(db) : listUsersForDropdown(db);
}
