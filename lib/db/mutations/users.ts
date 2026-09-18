import { and, eq, ne, sql } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { newId } from "@/lib/validation/ids";
import { vToken } from "@/lib/db/occ";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import type { AnyDb } from "@/lib/auth/db-types";
import type { z } from "zod";
import type { userCreate, userUpdate } from "@/lib/validation/entities";

/**
 * User administration.
 *
 * Two things the old app got wrong, both fixed here.
 *
 * THE LAST-ADMIN GUARD WAS CHECKED AGAINST THE BROWSER'S ARRAY.
 * `write.js` did `if (!data.some(u => u.role === 'admin'))` — where `data` is
 * the payload the client posted, not the state of the table. Two admins
 * demoting each other from two tabs each saw the other still listed as admin
 * in their own stale copy, so both writes passed the check and the
 * organisation was left with zero admins and no way back into the admin panel.
 * The guard now runs inside the same transaction as the write, against the
 * database.
 *
 * PASSWORD HASHES WERE ACCEPTED FROM THE CLIENT.
 * A `passwordHash` in the request body was written straight to the column,
 * which turned any stolen editor session into a way to set an admin's hash to
 * one you knew. Only plaintext is accepted now, and only ever hashed here.
 */

/**
 * Fails when a write would leave the system with no admin.
 *
 * THE ADVISORY LOCK IS LOAD-BEARING, and moving this check inside the
 * transaction was not sufficient on its own.
 *
 * Under READ COMMITTED — Postgres's default — two transactions demoting two
 * DIFFERENT admins never contend: each counts the other as still an admin,
 * because neither can see the other's uncommitted write. Both pass, both
 * commit, and the organisation is left with nobody who can reach the admin
 * panel. They touch different rows, so the If-Match checks do not collide
 * either. This is the exact failure the old app had; keeping the check
 * in-transaction narrowed the window without closing it.
 *
 * `FOR UPDATE` on the admin rows would close it but invites a deadlock: A
 * demoting admin1 locks admin2 while B demoting admin2 locks admin1. A
 * transaction-scoped advisory lock on one fixed key serialises every
 * role-changing write instead, with no ordering to get wrong and automatic
 * release on commit or rollback.
 *
 * Role changes are rare — a handful a year — so serialising them costs
 * nothing worth measuring.
 */
const ADMIN_ROLE_LOCK = 8_140_2701; // arbitrary, fixed; only identity matters

async function assertAdminRemains(
  tx: AnyDb,
  excludingUserId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_ROLE_LOCK})`);

  const [{ remaining }] = await tx
    .select({ remaining: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), ne(users.id, excludingUserId)));

  if (remaining === 0) {
    throw badRequest(
      "This is the last admin. Promote someone else before changing this account.",
    );
  }
}

export async function createUser(
  db: AnyDb,
  input: z.infer<typeof userCreate>,
): Promise<Record<string, unknown>> {
  // Case-insensitive, matching the unique index and the login lookup. Without
  // this, "Meera" and "meera" are two accounts that both answer to one login.
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${input.username})`)
    .limit(1);

  if (taken) throw conflict("That username is already taken.");

  const id = newId("u");
  const [row] = await db
    .insert(users)
    .values({
      id,
      username: input.username,
      name: input.name,
      email: input.email || "",
      role: input.role,
      passwordHash: await hashPassword(input.password),
      tokenVersion: 0,
    })
    .returning({
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    });

  return { ...row, _v: await tokenFor(db, id) };
}

/**
 * Updates a user.
 *
 * Runs in a transaction because the role change and the last-admin check have
 * to be one operation — the whole failure mode is two concurrent demotions
 * each passing a check made before the other's write.
 */
export async function updateUser(
  db: AnyDb,
  id: string,
  token: string,
  patch: z.infer<typeof userUpdate>,
): Promise<Record<string, unknown>> {
  return db.transaction(async (t) => {
    const tx = t as unknown as AnyDb;

    const [existing] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!existing) throw notFound("That user no longer exists");

    // Demoting the last admin locks everyone out of the admin panel
    // permanently — there is no recovery path that does not involve the
    // database directly.
    if (existing.role === "admin" && patch.role && patch.role !== "admin") {
      await assertAdminRemains(tx, id);
    }

    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.email !== undefined) values.email = patch.email;
    if (patch.role !== undefined) values.role = patch.role;

    if (patch.password !== undefined) {
      values.passwordHash = await hashPassword(patch.password);
      // Every other session belonging to this user dies. An admin resetting
      // someone's password is nearly always responding to a problem with that
      // account, and leaving existing sessions alive would defeat the reset.
      values.tokenVersion = sql`${users.tokenVersion} + 1`;
    }

    const updated = await tx
      .update(users)
      .set(values)
      .where(
        and(
          eq(users.id, id),
          sql`${users.updatedAt} = ${token}::timestamptz`,
        ),
      )
      .returning({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        role: users.role,
      });

    if (!updated.length) {
      const current = await currentUser(tx, id);
      if (!current) throw notFound("That user no longer exists");
      throw conflict("Someone else changed this account while you were editing it.", {
        code: "conflict",
        entity: "user",
        id,
        current,
      });
    }

    return { ...updated[0], _v: await tokenFor(tx, id) };
  });
}

/**
 * Deletes a user.
 *
 * A real delete, not an archive — unlike the tracker entities. A user row is
 * the login credential, and leaving an archived row behind would keep the
 * username reserved and keep a bcrypt hash on disk for an account nobody can
 * reach. Their name stays on every audit row and every activity entry they
 * wrote, because those store the display name as text rather than a reference.
 */
export async function deleteUser(
  db: AnyDb,
  id: string,
  token: string,
  actorId: string,
): Promise<{ id: string }> {
  if (id === actorId) {
    throw badRequest("You cannot delete your own account.");
  }

  return db.transaction(async (t) => {
    const tx = t as unknown as AnyDb;

    const [existing] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!existing) throw notFound("That user no longer exists");
    if (existing.role === "admin") await assertAdminRemains(tx, id);

    const removed = await tx
      .delete(users)
      .where(
        and(eq(users.id, id), sql`${users.updatedAt} = ${token}::timestamptz`),
      )
      .returning({ id: users.id });

    if (!removed.length) {
      const current = await currentUser(tx, id);
      if (!current) throw notFound("That user no longer exists");
      throw conflict("That account changed while you were deleting it.", {
        code: "conflict",
        entity: "user",
        id,
        current,
      });
    }

    return { id };
  });
}

async function currentUser(db: AnyDb, id: string) {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      role: users.role,
      _v: vToken(users.updatedAt),
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}

async function tokenFor(db: AnyDb, id: string): Promise<string | null> {
  const [row] = await db
    .select({ _v: vToken(users.updatedAt) })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row?._v ?? null;
}
