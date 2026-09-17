import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import {
  users, clients, integrations, milestones, modules, phases, amsWorkLog,
} from "@/lib/db/schema";
import { createClient, updateClient, archiveClient, restoreClient } from "@/lib/db/mutations/clients";
import {
  createIntegration, updateIntegration, archiveIntegration,
  createMilestone, createModule, archiveModule, updatePhase,
  createWorkLogEntry, updateWorkLogEntry,
} from "@/lib/db/mutations/tracker";
import {
  appendActivity, editActivity, deleteActivity, writeAtIndex,
} from "@/lib/db/mutations/activity";
import { createUser, updateUser, deleteUser } from "@/lib/db/mutations/users";
import { getClientTree } from "@/lib/db/queries/clients";
import { PHASES } from "@/lib/domain/constants";
import type { AnyDb } from "@/lib/auth/db-types";
import type { SessionUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";

/**
 * Write paths.
 *
 * The cases that matter here are the ones the old app got wrong: a stale save
 * silently overwriting a fresh one, a delete removing rows nobody named, a
 * cascade committing halfway, and the last-admin guard being checked against
 * the browser's copy of the table instead of the table.
 */

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

let pg: PGlite;
let db: AnyDb;

const ADMIN: SessionUser = {
  id: "u1", username: "meera", name: "Meera", role: "admin", tokenVersion: 0,
};
const EDITOR: SessionUser = {
  id: "u2", username: "vikram", name: "Vikram", role: "editor", tokenVersion: 0,
};

// One database for the file, truncated between tests. Building a fresh PGlite
// per test costs about a second each and pushed this file past two minutes;
// truncation gives the same isolation for a fraction of the time.
beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as AnyDb;
  await pg.exec(`do $$ begin
    if not exists (select from pg_roles where rolname='service_role') then
      create role service_role;
    end if; end $$;`);
  for (const f of [
    "0001_baseline_v1_schema.sql",
    "0002_v2_schema.sql",
    "0003_domain_membership.sql",
    "0004_client_name_ci_unique.sql",
    "0005_backend_indexes.sql",
    "0006_updated_at_trigger.sql",
  ]) {
    await pg.exec(read(f));
  }
}, 60_000);

beforeEach(async () => {
  await pg.exec(`truncate table
    phases_v2, modules_v2, milestones_v2, integrations_v2,
    ams_work_log_v2, clients_v2, users, audit_log restart identity cascade`);

  await db.insert(users).values([
    { id: "u1", username: "meera", name: "Meera", email: "m@x.com",
      role: "admin", passwordHash: "$2b$12$x", tokenVersion: 0 },
    { id: "u2", username: "vikram", name: "Vikram", email: "v@x.com",
      role: "editor", passwordHash: "$2b$12$x", tokenVersion: 0 },
  ]);
});

afterAll(async () => {
  await pg?.close();
});

const newClient = (name = "Aster Retail") =>
  createClient(db, { name, hasImplementation: true, hasAms: true });

/* ================================================================ trigger */

describe("updated_at is maintained by the database", () => {
  it("advances on every update without the statement setting it", async () => {
    // The whole OCC scheme rests on this. If it were left to each statement,
    // one that forgot would silently disable concurrency control for that
    // entity — writes would keep returning 200 while overwriting each other.
    const c = await newClient();
    const before = c._v as string;

    const after = await updateClient(db, c.id as string, before, { description: "SAP" });

    expect(after._v).not.toBe(before);
    expect(Date.parse(after._v as string)).toBeGreaterThan(Date.parse(before));
  });

  it("ignores an updated_at the caller tries to pin", async () => {
    const c = await newClient();
    await db
      .update(clients)
      .set({ description: "x", updatedAt: "1999-01-01T00:00:00.000Z" })
      .where(eq(clients.id, c.id as string));

    const [row] = await db
      .select({ v: clients.updatedAt }).from(clients)
      .where(eq(clients.id, c.id as string));
    expect(Date.parse(row.v)).toBeGreaterThan(Date.parse("2020-01-01"));
  });
});

/* ==================================================================== OCC */

describe("optimistic concurrency", () => {
  it("accepts a write carrying the current token", async () => {
    const c = await newClient();
    const out = await updateClient(db, c.id as string, c._v as string, {
      masterAssignee: "Arjun",
    });
    expect(out.masterAssignee).toBe("Arjun");
  });

  it("rejects a stale write and returns the current row to heal from", async () => {
    const c = await newClient();
    const stale = c._v as string;

    // Someone else saves first.
    await updateClient(db, c.id as string, stale, { description: "theirs" });

    // This tab still holds the token from before that save.
    const err = await updateClient(db, c.id as string, stale, {
      description: "mine",
    }).catch((e) => e);

    expect(err.statusCode).toBe(409);
    expect(err.extra.code).toBe("conflict");
    // The fresh row travels with the error so the client can show what
    // changed instead of dropping the user back to a reload.
    expect(err.extra.current.description).toBe("theirs");
    expect(err.extra.current._v).toBeTruthy();

    // THE CASING OF `current` IS PART OF THE CONTRACT, and until now nothing
    // asserted it. `currentRow` builds this with `to_jsonb(<table>)`, which
    // emits the DATABASE's column names, while every success response comes
    // back from Drizzle in camelCase — so the client converts before healing
    // from it. `description` is a single word and spelled identically either
    // way, so the assertion above passes whatever the casing is; the client's
    // conversion was pinned only to a hand-written mock of what I believed the
    // server sent. A MULTI-WORD column settles it against the real thing.
    expect(err.extra.current).toHaveProperty("man_day_rate");
    expect(err.extra.current).toHaveProperty("has_ams");
    expect(err.extra.current).not.toHaveProperty("manDayRate");

    const [row] = await db.select().from(clients).where(eq(clients.id, c.id as string));
    expect(row.description).toBe("theirs"); // the losing write did not land
  });

  it("reports a deleted row as gone, not as a conflict", async () => {
    // Telling someone their record was edited when it was actually deleted
    // sends them looking for changes that do not exist, and vice versa.
    const c = await newClient();
    const token = c._v as string;
    await archiveClient(db, c.id as string, token);

    const err = await updateClient(db, c.id as string, token, { description: "x" })
      .catch((e) => e);
    expect(err.statusCode).toBe(404);
  });

  it("guards deletes too, which the old app did not", async () => {
    const c = await newClient();
    const stale = c._v as string;
    await updateClient(db, c.id as string, stale, { description: "moved on" });

    const err = await archiveClient(db, c.id as string, stale).catch((e) => e);
    expect(err.statusCode).toBe(409);

    const [row] = await db.select().from(clients).where(eq(clients.id, c.id as string));
    expect(row.archived).toBe(false);
  });
});

/* ================================================================ cascade */

describe("client archive cascade", () => {
  async function populated() {
    const c = await newClient();
    const cid = c.id as string;
    const i = await createIntegration(db, cid, { name: "Payroll" });
    await createMilestone(db, cid, { integrationId: i.id as string, name: "UAT" });
    await createModule(db, cid, { name: "Core HR" });
    await createWorkLogEntry(db, cid, { dateRaised: "2026-08-04", hours: 5 });
    return { client: c, cid };
  }

  it("archives every child so nothing is left orphaned in the aggregates", async () => {
    const { client, cid } = await populated();
    const res = await archiveClient(db, cid, client._v as string);

    expect(res.archived).toEqual({
      integrations: 1, milestones: 1, modules: 1, phases: 9, workLog: 1,
    });

    for (const t of [integrations, milestones, modules, phases, amsWorkLog]) {
      const rows = await db.select().from(t).where(eq(t.clientId, cid));
      expect(rows.every((r) => r.archived)).toBe(true);
    }
  });

  it("touches nothing when the client's own token is stale", async () => {
    // Atomicity: a cascade that archived the children and then failed on the
    // parent would leave the client visible with an empty tree.
    const { client, cid } = await populated();
    const stale = client._v as string;
    await updateClient(db, cid, stale, { description: "moved on" });

    await expect(archiveClient(db, cid, stale)).rejects.toMatchObject({
      statusCode: 409,
    });

    const rows = await db.select().from(integrations).where(eq(integrations.clientId, cid));
    expect(rows.every((r) => !r.archived)).toBe(true);
  });

  it("restores the client and its children", async () => {
    const { client, cid } = await populated();
    await archiveClient(db, cid, client._v as string);

    const res = await restoreClient(db, cid);
    expect(res.restored.phases).toBe(9);
    expect(await getClientTree(db, cid)).toBeTruthy();
  });

  it("refuses to restore into a name another client has taken", async () => {
    const { client, cid } = await populated();
    await archiveClient(db, cid, client._v as string);
    await newClient("Aster Retail"); // the freed name gets reused

    await expect(restoreClient(db, cid)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("archives an integration together with its milestones", async () => {
    const { cid } = await populated();
    const [i] = await db.select().from(integrations).where(eq(integrations.clientId, cid));
    const [tok] = await db
      .select({ v: sql<string>`to_char(${integrations.updatedAt} at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
      .from(integrations).where(eq(integrations.id, i.id));

    const res = await archiveIntegration(db, i.id, tok.v);
    expect(res.archivedMilestones).toBe(1);
  });

  it("records WHEN and BY WHOM it was archived, on the row and its cascade", async () => {
    // Every table has carried archived_at/archived_by since the v2 schema and
    // nothing ever wrote them, so a row archived a minute ago was
    // indistinguishable from one archived two years ago. That matters because
    // soft delete IS the recovery story — the UI tells people an administrator
    // can restore the record — and the audit log cannot fill the gap: it
    // records the entity as a TABLE NAME with no record id, so it can never be
    // joined back to a row.
    const { cid } = await populated();
    const [i] = await db.select().from(integrations).where(eq(integrations.clientId, cid));
    const [tok] = await db
      .select({ v: sql<string>`to_char(${integrations.updatedAt} at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
      .from(integrations).where(eq(integrations.id, i.id));

    await archiveIntegration(db, i.id, tok.v, "Meera Raghavan");

    const [row] = await db.select().from(integrations).where(eq(integrations.id, i.id));
    expect(row.archived).toBe(true);
    expect(row.archivedBy).toBe("Meera Raghavan");
    expect(Date.parse(String(row.archivedAt))).not.toBeNaN();

    // The cascade carries the SAME stamp, so a recovery can find everything
    // that went at once rather than guessing from adjacent timestamps.
    const [ms] = await db.select().from(milestones).where(eq(milestones.integrationId, i.id));
    expect(ms.archivedBy).toBe("Meera Raghavan");
    expect(ms.archivedAt).toBe(row.archivedAt);
  });
});

/* ================================================================= modules */

describe("modules and phases", () => {
  it("creates exactly the nine fixed phases, atomically", async () => {
    const c = await newClient();
    const m = await createModule(db, c.id as string, { name: "Core HR" });

    const rows = await db.select().from(phases).where(eq(phases.moduleId, m.id as string));
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.phaseName).sort()).toEqual([...PHASES].sort());
  });

  it("archives a module together with its phases", async () => {
    const c = await newClient();
    const m = await createModule(db, c.id as string, { name: "Core HR" });
    const res = await archiveModule(db, m.id as string, m._v as string);
    expect(res.archivedPhases).toBe(9);
  });

  it("blocks completing a signoff phase with no document attached", async () => {
    // Enforced only in the browser before now: js/events.js returned early,
    // so anything talking to the API directly could complete it regardless.
    const c = await newClient();
    await createModule(db, c.id as string, { name: "Core HR" });
    const [ph] = await db
      .select().from(phases)
      .where(eq(phases.phaseName, "BPU Signoff"));

    const err = await updatePhase(db, ph.id, await tokenOfPhase(ph.id), {
      status: "Completed",
    }).catch((e) => e);

    expect(err.statusCode).toBe(400);
    expect(err.extra.code).toBe("signoff_document_required");
  });

  it("allows it once an update carries a document", async () => {
    const c = await newClient();
    await createModule(db, c.id as string, { name: "Core HR" });
    const [ph] = await db
      .select().from(phases).where(eq(phases.phaseName, "CRP Signoff"));

    await appendActivity(db, "phase", ph.id, ADMIN, {
      update: "Signed off",
      attachment: { storagePath: "c/sign.pdf", fileName: "sign.pdf" },
    });

    const out = await updatePhase(db, ph.id, await tokenOfPhase(ph.id), {
      status: "Completed",
    });
    expect(out.status).toBe("Completed");
  });

  it("checks the stored path, not a signed url", async () => {
    // The old client looked for `attachment.url`. URLs are generated per read
    // and never stored now, so checking for one would reject every genuinely
    // signed-off phase.
    const c = await newClient();
    await createModule(db, c.id as string, { name: "Payroll" });
    const [ph] = await db
      .select().from(phases).where(eq(phases.phaseName, "UAT Signoff"));

    await db.update(phases).set({
      activityLog: sql`'[{"id":"t1","update":"x","addedBy":"Meera","attachment":{"storagePath":"c/a.pdf","fileName":"a.pdf"}}]'::jsonb`,
    }).where(eq(phases.id, ph.id));

    const out = await updatePhase(db, ph.id, await tokenOfPhase(ph.id), {
      status: "Completed",
    });
    expect(out.status).toBe("Completed");
  });

  it("does not gate a non-signoff phase", async () => {
    const c = await newClient();
    await createModule(db, c.id as string, { name: "Core HR" });
    const [ph] = await db.select().from(phases).where(eq(phases.phaseName, "BPU"));
    const out = await updatePhase(db, ph.id, await tokenOfPhase(ph.id), {
      status: "Completed",
    });
    expect(out.status).toBe("Completed");
  });
});

async function tokenOfPhase(id: string): Promise<string> {
  const [row] = await db
    .select({ v: sql<string>`to_char(${phases.updatedAt} at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
    .from(phases).where(eq(phases.id, id));
  return row.v;
}

/* ================================================================ activity */

describe("activity feeds", () => {
  async function feed() {
    const c = await newClient();
    const i = await createIntegration(db, c.id as string, { name: "Payroll" });
    return i.id as string;
  }

  it("does not lose either of two posts made against the same stale view", async () => {
    // The failure this replaces: the old app rewrote the whole array from the
    // browser's copy, so the second poster's save erased the first comment.
    // Neither call re-reads between them — the concatenation happens in SQL.
    const id = await feed();

    await appendActivity(db, "integration", id, ADMIN, { update: "first" });
    await appendActivity(db, "integration", id, EDITOR, { update: "second" });

    const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
    expect(row.activityLog.map((e) => e.update)).toEqual(["second", "first"]);
  });

  it("stores newest first, matching every migrated feed", async () => {
    // v1 did timeline.unshift(). Appending on the right would put new entries
    // below years of older ones.
    const id = await feed();
    await appendActivity(db, "integration", id, ADMIN, { update: "older" });
    await appendActivity(db, "integration", id, ADMIN, { update: "newer" });

    const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
    expect(row.activityLog[0].update).toBe("newer");
  });

  it("attributes the entry from the session, not the request", async () => {
    const id = await feed();
    const { entry } = await appendActivity(db, "integration", id, EDITOR, {
      update: "mine",
    });
    expect(entry.addedBy).toBe("Vikram");
    expect(entry.addedAt).toBeTruthy();
  });

  it("keeps the previous text when an entry is edited", async () => {
    const id = await feed();
    const { entry } = await appendActivity(db, "integration", id, EDITOR, {
      update: "original",
    });
    const edited = await editActivity(db, "integration", id, entry.id, EDITOR, {
      update: "revised",
    });

    expect(edited.entry.update).toBe("revised");
    expect(edited.entry.history?.[0].update).toBe("original");
  });

  it("lets only the author or an admin change an entry", async () => {
    const id = await feed();
    const { entry } = await appendActivity(db, "integration", id, ADMIN, {
      update: "Meera's note",
    });

    await expect(
      editActivity(db, "integration", id, entry.id, EDITOR, { update: "hijack" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    // The admin who wrote it still can.
    await expect(
      editActivity(db, "integration", id, entry.id, ADMIN, { update: "fixed" }),
    ).resolves.toBeTruthy();
  });

  it("deletes the entry it was asked to delete", async () => {
    const id = await feed();
    const a = await appendActivity(db, "integration", id, ADMIN, { update: "a" });
    await appendActivity(db, "integration", id, ADMIN, { update: "b" });

    await deleteActivity(db, "integration", id, a.entry.id, ADMIN);

    const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
    expect(row.activityLog.map((e) => e.update)).toEqual(["b"]);
  });

  it("REFUSES A WRITE WHOSE ENTRY MOVED, rather than hitting a stranger's", async () => {
    /**
     * The race, demonstrated before it was fixed:
     *
     *   Meera opens the edit box. locate() resolves her entry to index 0.
     *   Before the write lands, Vikram posts — and appendActivity PREPENDS, so
     *   Vikram takes index 0 and Meera shifts to 1. The write then targets
     *   index 0 and replaces VIKRAM'S comment, text and history, with Meera's
     *   edit. His words gone, no error, no trace.
     *
     * deleteActivity always guarded this; editActivity did not, and the
     * comment above it asserted the race was impossible.
     *
     * This drives `writeAtIndex` — the real function both paths call — with
     * the stale index locate() would have returned. An earlier version of this
     * test re-implemented the guard SQL inline, which meant deleting the guard
     * from production left it passing. It is exported precisely so this test
     * cannot drift from the code again.
     */
    const id = await feed();
    await appendActivity(db, "integration", id, ADMIN, { update: "MEERA ORIGINAL" });
    const staleIndex = 0; // what locate() would have returned for Meera

    await appendActivity(db, "integration", id, EDITOR, { update: "VIKRAM COMMENT" });

    const meera = (await db.select().from(integrations).where(eq(integrations.id, id)))[0]
      .activityLog.find((e) => e.update === "MEERA ORIGINAL")!;

    const hit = await writeAtIndex(db, integrations, id, staleIndex, meera.id, {
      activityLog: sql`jsonb_set(${integrations.activityLog}, ${`{${staleIndex}}`}::text[],
        ${JSON.stringify({ ...meera, update: "MEERA EDITED" })}::jsonb, false)`,
    });

    expect(hit).toBe(false);

    const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
    expect(row.activityLog.map((e) => e.update))
      .toEqual(["VIKRAM COMMENT", "MEERA ORIGINAL"]);
  });

  it("allows the write when the entry is still where it was", async () => {
    // The other half — the guard must not reject a legitimate edit.
    const id = await feed();
    const mine = await appendActivity(db, "integration", id, ADMIN, { update: "mine" });
    const hit = await writeAtIndex(db, integrations, id, 0, mine.entry.id, {
      activityLog: sql`jsonb_set(${integrations.activityLog}, '{0}'::text[],
        ${JSON.stringify({ ...mine.entry, update: "edited" })}::jsonb, false)`,
    });
    expect(hit).toBe(true);
  });

  it("edits the right entry after someone else posts", async () => {
    // The same situation through the real function: editActivity re-locates,
    // so a post before the call is harmless. This is what must keep working.
    const id = await feed();
    const mine = await appendActivity(db, "integration", id, ADMIN, { update: "mine" });
    await appendActivity(db, "integration", id, EDITOR, { update: "theirs" });

    await editActivity(db, "integration", id, mine.entry.id, ADMIN, { update: "mine, edited" });

    const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
    expect(row.activityLog.map((e) => e.update)).toEqual(["theirs", "mine, edited"]);
  });

  it("refuses an entry that moved rather than deleting the wrong one", async () => {
    const id = await feed();
    const a = await appendActivity(db, "integration", id, ADMIN, { update: "a" });

    // Someone else's post shifts every index by one between locate and delete.
    const shift = async () => {
      await appendActivity(db, "integration", id, EDITOR, { update: "b" });
    };

    // Reproduce the interleaving directly: resolve the index, then shift, then
    // issue the delete against the now-wrong index.
    await db.update(integrations)
      .set({ activityLog: sql`${integrations.activityLog}` })
      .where(eq(integrations.id, id));
    await shift();

    await expect(
      deleteActivityAtStaleIndex(id, a.entry.id, 0),
    ).resolves.toBe(0);
  });
});

/**
 * Issues the delete statement with a deliberately stale index, the way a
 * concurrent post would leave it, and reports how many rows it touched.
 */
async function deleteActivityAtStaleIndex(
  parentId: string, entryId: string, index: number,
): Promise<number> {
  const rows = await db
    .update(integrations)
    .set({ activityLog: sql`${integrations.activityLog} - ${index}` })
    .where(
      sql`${integrations.id} = ${parentId}
          and ${integrations.activityLog} -> ${index} ->> 'id' = ${entryId}`,
    )
    .returning({ id: integrations.id });
  return rows.length;
}

/* =================================================================== users */

describe("user administration", () => {
  it("never accepts a password hash from the caller", async () => {
    const u = await createUser(db, {
      username: "priya", name: "Priya", email: "p@x.com",
      role: "editor", password: "correct-horse",
    });
    const [row] = await db.select().from(users).where(eq(users.id, u.id as string));
    expect(row.passwordHash.startsWith("$2")).toBe(true);
    expect(row.passwordHash).not.toContain("correct-horse");
    expect(JSON.stringify(u)).not.toContain("passwordHash");
  });

  it("rejects a duplicate username case-insensitively", async () => {
    await expect(
      createUser(db, {
        username: "MEERA", name: "Other", email: "o@x.com",
        role: "viewer", password: "correct-horse",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses to demote the last admin", async () => {
    // The old check ran against the array the browser posted, so two tabs
    // demoting each other both passed and left zero admins.
    const token = await tokenOfUser("u1");
    await expect(
      updateUser(db, "u1", token, { role: "viewer" }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const [row] = await db.select().from(users).where(eq(users.id, "u1"));
    expect(row.role).toBe("admin");
  });

  /**
   * The CONCURRENT last-admin race is not tested here, on purpose.
   *
   * PGlite is a single connection, so two transactions serialise no matter
   * what the code does — a passing test would prove nothing. That is precisely
   * how the bug survived the first time: the guard was moved inside a
   * transaction, the sequential test below went green, and everyone assumed
   * the race was closed. It was not; under READ COMMITTED two transactions
   * demoting two different admins never contend.
   *
   * The real proof needs two connections and lives in
   * `scripts/verify-admin-lock.ts` (`pnpm verify:admin-lock`), which runs
   * against local Postgres and demonstrates both halves: without the advisory
   * lock the run ends with ZERO admins, with it one demotion is refused.
   */

  it("allows the demotion once another admin exists", async () => {
    await createUser(db, {
      username: "priya", name: "Priya", email: "p@x.com",
      role: "admin", password: "correct-horse",
    });
    const out = await updateUser(db, "u1", await tokenOfUser("u1"), {
      role: "viewer",
    });
    expect(out.role).toBe("viewer");
  });

  it("signs a user out everywhere when an admin resets their password", async () => {
    const before = (await db.select().from(users).where(eq(users.id, "u2")))[0];
    await updateUser(db, "u2", await tokenOfUser("u2"), {
      password: "brand-new-password",
    });
    const after = (await db.select().from(users).where(eq(users.id, "u2")))[0];

    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(after.passwordHash).not.toBe(before.passwordHash);
  });

  it("refuses to delete the last admin or yourself", async () => {
    await expect(
      deleteUser(db, "u1", await tokenOfUser("u1"), "u2"),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      deleteUser(db, "u1", await tokenOfUser("u1"), "u1"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("applies OCC to user writes", async () => {
    const stale = await tokenOfUser("u2");
    await updateUser(db, "u2", stale, { name: "Vikram S" });
    await expect(
      updateUser(db, "u2", stale, { name: "Someone else" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

async function tokenOfUser(id: string): Promise<string> {
  const [row] = await db
    .select({ v: sql<string>`to_char(${users.updatedAt} at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
    .from(users).where(eq(users.id, id));
  return row.v;
}

/* ================================================================ patching */

describe("partial updates", () => {
  it("leaves fields the patch did not mention alone", async () => {
    // undefined means "not in this patch"; collapsing it with null would make
    // every partial update wipe the fields it did not name — the row-level
    // form of the delete-by-omission bug.
    const c = await newClient();
    await updateClient(db, c.id as string, c._v as string, {
      description: "SAP", masterAssignee: "Arjun",
    });
    const fresh = await getClientTree(db, c.id as string);

    await updateClient(db, c.id as string, fresh!._v, { description: "SAP S/4" });

    const after = await getClientTree(db, c.id as string);
    expect(after!.masterAssignee).toBe("Arjun");
  });

  it("clears a field when the patch explicitly sends null", async () => {
    const c = await newClient();
    const v1 = await updateClient(db, c.id as string, c._v as string, {
      masterAssignee: "Arjun",
    });
    await updateClient(db, c.id as string, v1._v as string, {
      masterAssignee: null,
    });

    const [row] = await db.select().from(clients).where(eq(clients.id, c.id as string));
    expect(row.masterAssignee).toBeNull();
  });

  it("rejects a duplicate client name case-insensitively", async () => {
    await newClient("Aster Retail");
    const err = await newClient("  aster retail  ").catch((e) => e);

    // Asserted through the error mapper, not on the raw driver error: Drizzle
    // wraps it, and reading `.code` off the wrapper finds nothing — which is
    // how a duplicate name used to surface as a 500 with a correlation id.
    const res = errorResponse(err, "test");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "A client with that name already exists.",
    });
  });

  it("frees the name once a client is archived", async () => {
    const c = await newClient("Aster Retail");
    await archiveClient(db, c.id as string, c._v as string);
    await expect(newClient("Aster Retail")).resolves.toBeTruthy();
  });

  it("maps wire names onto their columns for the work log", async () => {
    const c = await newClient();
    const w = await createWorkLogEntry(db, c.id as string, {
      dateRaised: "2026-08-04", type: "Bug Fix", hours: 6.5,
    });
    const out = await updateWorkLogEntry(db, w.id as string, w._v as string, {
      type: "Enhancement", hours: 8,
    });
    expect(out.entryType).toBe("Enhancement");
    expect(Number(out.hours)).toBe(8);
  });

  it("will not attach a milestone to another client's integration", async () => {
    const a = await newClient("Alpha");
    const b = await newClient("Beta");
    const i = await createIntegration(db, a.id as string, { name: "Payroll" });

    await expect(
      createMilestone(db, b.id as string, {
        integrationId: i.id as string, name: "Sneak",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("will not add a child to an archived client", async () => {
    const c = await newClient();
    await archiveClient(db, c.id as string, c._v as string);
    await expect(
      createIntegration(db, c.id as string, { name: "Late" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("integration updates", () => {
  it("round-trips through the read path", async () => {
    const c = await newClient();
    const i = await createIntegration(db, c.id as string, {
      name: "Payroll", status: "At Risk", dueDate: "2026-09-02", effortWeight: 2,
    });
    await updateIntegration(db, i.id as string, i._v as string, {
      nextAction: "chase finance",
    });

    const tree = await getClientTree(db, c.id as string);
    expect(tree!.integrations?.[0]).toMatchObject({
      name: "Payroll", status: "At Risk", dueDate: "2026-09-02",
      effortWeight: 2, nextAction: "chase finance",
    });
  });
});
