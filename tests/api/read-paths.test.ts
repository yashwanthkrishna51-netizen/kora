import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import {
  users,
  clients,
  integrations,
  milestones,
  modules,
  phases,
  amsWorkLog,
  appSettings,
  portfolioSnapshots,
  auditLog,
} from "@/lib/db/schema";
import {
  listClients,
  getClientTrees,
  getClientTree,
} from "@/lib/db/queries/clients";
import { listUsers, listUsersForAdmin } from "@/lib/db/queries/users";
import { implSignoffCounts } from "@/lib/domain/implementation";
import {
  getCapacityWeights,
  getDigestRecipients,
  listSnapshots,
  listAudit,
} from "@/lib/db/queries/misc";
import { DEFAULT_CAPACITY_WEIGHTS } from "@/lib/domain/constants";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Read paths.
 *
 * The role-shaping cases are the point: the old app leaked the digest
 * recipient list to any viewer because one endpoint was missing a role check,
 * so "a viewer cannot see X" is asserted directly rather than assumed from the
 * route wrapper.
 */

/** Health is all date arithmetic, so the clock is pinned rather than read. */
const FROZEN = new Date("2026-09-08T00:00:00.000Z");

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

let pg: PGlite;
let db: AnyDb;

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
    "0005_backend_indexes.sql",
    // Production has this trigger; a test schema without it silently makes
    // updated_at (and therefore every OCC token) hold still.
    "0006_updated_at_trigger.sql",
  ]) {
    await pg.exec(read(f));
  }

  await db.insert(users).values([
    {
      id: "u1",
      username: "meera",
      name: "Meera",
      email: "m@example.com",
      role: "admin",
      passwordHash: "$2b$12$hashvaluehere",
      tokenVersion: 0,
      failedAttempts: 3,
      lockoutLevel: 1,
      lockedUntil: "2026-09-02T00:00:00.000Z",
    },
    {
      id: "u2",
      username: "vikram",
      name: "Vikram",
      email: "v@example.com",
      role: "viewer",
      passwordHash: "$2b$12$hashvaluehere",
      tokenVersion: 0,
    },
  ]);

  await db.insert(clients).values([
    {
      id: "c_full",
      name: "Aster Retail",
      description: "SAP",
      currency: "INR",
      manDayRate: "8000",
      totalAvailableHours: "120",
      masterAssignee: "Arjun",
      hasImplementation: true,
      hasAms: true,
      updatedAt: "2026-08-01T09:30:00.000Z",
    },
    // In the Implementation domain with ZERO modules — the sentinel case.
    {
      id: "c_empty",
      name: "Swastik",
      hasImplementation: true,
      hasAms: false,
      updatedAt: "2026-08-02T09:30:00.000Z",
    },
    { id: "c_archived", name: "Gone", archived: true },
  ]);

  await db.insert(integrations).values([
    {
      id: "i1",
      clientId: "c_full",
      name: "Payroll sync",
      status: "At Risk",
      assignee: "Kavya",
      dueDate: "2026-09-02",
      effortWeight: "1",
      activityLog: [
        {
          id: "t1",
          date: "2026-08-20",
          update: "signed off",
          addedBy: "Meera",
          attachment: {
            storagePath: "1_a_signoff.pdf",
            fileName: "signoff.pdf",
          },
        },
      ] as never,
    },
    { id: "i_arch", clientId: "c_full", name: "Old", archived: true },
  ]);
  await db.insert(milestones).values({
    id: "ms1",
    integrationId: "i1",
    clientId: "c_full",
    name: "UAT sign-off",
    status: "Pending",
    dueDate: "2026-09-04",
  });
  await db
    .insert(modules)
    .values({ id: "m1", clientId: "c_full", name: "Core HR" });
  await db.insert(phases).values({
    id: "p1",
    moduleId: "m1",
    clientId: "c_full",
    phaseName: "BPU",
    status: "Completed",
    targetDate: "2026-03-01",
  });
  // The sign-off gate, both sides of it. A Signoff phase marked Completed is
  // NOT signed off without a document attached to one of its updates — v1 had
  // no such rule, so migrated rows really are in this state.
  await db.insert(phases).values([
    {
      id: "p_gate_open",
      moduleId: "m1",
      clientId: "c_full",
      phaseName: "BPU Signoff",
      status: "Completed",
      activityLog: [
        { id: "u1", date: "2026-03-02", update: "done", addedBy: "sam" },
      ],
    },
    {
      id: "p_gate_met",
      moduleId: "m1",
      clientId: "c_full",
      phaseName: "CRP Signoff",
      status: "Completed",
      activityLog: [
        {
          id: "u2",
          date: "2026-03-03",
          update: "signed",
          addedBy: "sam",
          attachment: {
            fileName: "signoff.pdf",
            storagePath: "c_full/crp.pdf",
          },
        },
      ],
    },
    // An attachment object with no path is not evidence.
    {
      id: "p_gate_empty_path",
      moduleId: "m1",
      clientId: "c_full",
      phaseName: "UAT Signoff",
      status: "Completed",
      activityLog: [
        {
          id: "u3",
          date: "2026-03-04",
          update: "oops",
          addedBy: "sam",
          attachment: { fileName: "nothing", storagePath: "" },
        },
      ],
    },
    // Not Completed at all, so the gate never comes into it.
    {
      id: "p_open",
      moduleId: "m1",
      clientId: "c_full",
      phaseName: "UAT",
      status: "In Progress",
    },
    // Archived, and Completed. It must appear in neither count — the SQL says
    // `archived = false` and the tree never loads it, so the two agree only if
    // both remember to exclude it.
    {
      id: "p_arch",
      moduleId: "m1",
      clientId: "c_full",
      phaseName: "Go Live",
      status: "Completed",
      archived: true,
    },
  ]);
  await db.insert(amsWorkLog).values({
    id: "w1",
    clientId: "c_full",
    dateRaised: "2026-08-04",
    description: "Leave accrual",
    entryType: "Bug Fix",
    queryLevel: "L4 - Critical",
    entryStatus: "Open",
    hours: "6.5",
  });

  await db.insert(appSettings).values([
    { key: "capacity_weights", value: { module: 2, cap: 4 } },
    {
      key: "digest_recipients",
      value: { emails: ["ops@example.com", "pmo@example.com"] },
    },
  ]);

  await db.insert(portfolioSnapshots).values({
    snapshotDate: "2026-08-30",
    clientId: "c_full",
    clientName: "Aster Retail",
    integTotal: 5,
    integAtRisk: 1,
    amsHoursMonth: "103.5",
    overallRag: "Amber",
  });

  await db.insert(auditLog).values([
    { action: "Login success", username: "meera", entity: "session" },
    { action: "Client updated", username: "vikram", entity: "clients" },
  ] as never);
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe("client list", () => {
  it("excludes archived clients and counts only active children", async () => {
    const rows = await listClients(db);
    expect(rows.map((r) => r.id)).toEqual(["c_full", "c_empty"]);

    const full = rows.find((r) => r.id === "c_full")!;
    // i_arch is archived, so the count is 1 rather than 2.
    expect(full.counts).toEqual({
      integrations: 1,
      modules: 1,
      phases: 5,
      phasesSignedOff: 2,
      workLog: 1,
    });
  });

  it("counts integration health off active rows only, on a frozen clock", async () => {
    // The rail's RAG dot and status bar (artboard 1c) come from these four
    // numbers in SQL, while the client's own screen computes the same four off
    // the tree. c_full holds one active integration and one archived one, so a
    // missing `archived = false` reads as a total of 2.
    //
    // The clock is frozen because every one of these numbers is a date
    // comparison — asserting them against `new Date()` would quietly change
    // meaning as the wall clock advanced.
    const rows = await listClients(db, FROZEN);
    const full = rows.find((r) => r.id === "c_full")!;

    // i1 is At Risk AND four days past its due date. `risk` folds the two
    // together, so the one row counts once — the whole reason the shape is not
    // {atRisk, overdue}. Its newest activity entry is 2026-08-20, nineteen
    // days back, so it is stale as well.
    expect(full.integHealth).toEqual({ total: 1, done: 0, risk: 1, stale: 1 });

    // No integrations at all is not "all green" — downstream it is a null RAG
    // and no dot, which is a different statement from "nothing is wrong".
    const empty = rows.find((r) => r.id === "c_empty")!;
    expect(empty.integHealth).toEqual({ total: 0, done: 0, risk: 0, stale: 0 });

    // counts.integrations is fed from integHealth.total, so they cannot drift.
    expect(full.counts.integrations).toBe(full.integHealth.total);
  });

  it("counts signed-off phases exactly as the client screen does", async () => {
    /**
     * THE NUMBER THE RAIL'S RING SHOWS, computed in SQL, against the same
     * number the client's own screen computes in JS off the tree. They sit one
     * click apart, so a disagreement is visible and unexplainable.
     *
     * The gate is the whole difficulty: three of these five phases are
     * Completed sign-off phases, and only the one with a real `storagePath`
     * counts. Plain `status = 'Completed'` would say 4.
     */
    const rows = await listClients(db);
    const trees = await getClientTrees(db);

    const diffs = rows.map((r) => {
      const tree = trees.find((t) => t.id === r.id)!;
      const js = implSignoffCounts(tree);
      return {
        client: r.id,
        sql: r.counts.phasesSignedOff,
        js: js.signedOff,
        total: { sql: r.counts.phases, js: js.total },
      };
    });

    expect(diffs).toEqual(
      diffs.map((d) => ({
        ...d,
        sql: d.js,
        total: { sql: d.total.js, js: d.total.js },
      })),
    );

    // And not vacuously: the fixture really does exercise both sides of the
    // gate, so an implementation that ignored it would show up here.
    const full = diffs.find((d) => d.client === "c_full")!;
    expect(full.sql).toBe(2);
    expect(full.total.sql).toBe(5);
  });

  it("gives the same health whatever the session timezone", async () => {
    // The reason `today` is bound from JS rather than read as `current_date`.
    // A session in IST rolls the date over five and a half hours early, which
    // would move every overdue and stale count for part of each night.
    const before = (await listClients(db, FROZEN)).map((r) => r.integHealth);
    await pg.exec("set time zone 'Asia/Kolkata'");
    const after = (await listClients(db, FROZEN)).map((r) => r.integHealth);
    await pg.exec("set time zone 'UTC'");
    expect(after).toEqual(before);
  });

  it("counts a never-updated integration as stale", async () => {
    // `isStale` returns true when there is no update at all — surprising, and
    // intentional since v1. The SQL has to agree, and it reaches that answer by
    // a different route (an empty jsonb array, not a null date), so it is
    // asserted rather than assumed.
    await db.insert(integrations).values({
      id: "i_never",
      clientId: "c_empty",
      name: "Never touched",
      status: "In Progress",
    });
    const empty = (await listClients(db, FROZEN)).find(
      (r) => r.id === "c_empty",
    )!;
    expect(empty.integHealth).toEqual({ total: 1, done: 0, risk: 0, stale: 1 });
  });

  it("issues a timezone-independent ISO _v for optimistic concurrency", async () => {
    // Not the driver's raw text. Postgres prints timestamptz in the session
    // timezone and trims trailing zeros, so the raw value is neither stable
    // across connections nor parseable by `new Date()`.
    const [full] = await listClients(db);
    expect(full._v).toBe("2026-08-01T09:30:00.000000Z");
    expect(Number.isNaN(Date.parse(full._v))).toBe(false);
  });

  it("issues the same _v regardless of the session timezone", async () => {
    // The whole reason to_char is there: a `SET timezone` must not change the
    // token, or two app instances would disagree about the same row.
    const before = (await listClients(db))[0]._v;
    await pg.exec("set time zone 'Asia/Kolkata'");
    const after = (await listClients(db))[0]._v;
    await pg.exec("set time zone 'UTC'");
    expect(after).toBe(before);
  });

  it("returns numerics as numbers, not strings", async () => {
    // numeric columns come back as strings from the driver; the DTO must not
    // hand the frontend "8000" where it expects to do arithmetic.
    const full = (await listClients(db)).find((r) => r.id === "c_full")!;
    expect(full.manDayRate).toBe(8000);
    expect(full.totalAvailableHours).toBe(120);
  });
});

describe("client tree", () => {
  it("nests the whole structure in the v1 shape", async () => {
    const tree = await getClientTree(db, "c_full");
    expect(tree).toBeTruthy();
    expect(tree!.integrations).toHaveLength(1);
    expect(tree!.integrations![0].name).toBe("Payroll sync");
    // By name, not by index: `phaseName` arriving as `name` is what this pins,
    // and the module now holds five phases in whatever order the query returns.
    expect(tree!.modules![0].phases!.map((p) => p.name)).toContain("BPU");
    expect(tree!.workLog![0].hours).toBe(6.5);
  });

  it("keeps a zero-module client inside the Implementation domain", async () => {
    // The sentinel again. If `modules` were absent rather than [], this client
    // would disappear from /implementation.
    const tree = await getClientTree(db, "c_empty");
    expect("modules" in tree!).toBe(true);
    expect(tree!.modules).toEqual([]);
    expect("workLog" in tree!).toBe(false);
  });

  it("omits archived children", async () => {
    const tree = await getClientTree(db, "c_full");
    expect(tree!.integrations!.map((i) => i.id)).toEqual(["i1"]);
  });

  it("returns null for an archived or unknown client", async () => {
    expect(await getClientTree(db, "c_archived")).toBeNull();
    expect(await getClientTree(db, "nope")).toBeNull();
  });

  it("fetches many clients without a query per client", async () => {
    const trees = await getClientTrees(db);
    expect(trees.map((t) => t.id)).toEqual(["c_full", "c_empty"]);
    expect(trees[0]._v).toBeTruthy();
  });

  /**
   * EVERY entity in the tree must carry an OCC token, not just the client.
   *
   * The read path and the write path each looked self-consistent and did not
   * agree. `getClientTrees` selected `_v` for clients only, while every child
   * PATCH and DELETE runs `requireIfMatch` before anything else — so editing
   * an integration, milestone, module, phase or work-log row was impossible:
   * the token it demands was never served. Nothing caught it because no test
   * had ever read the tree and written back from it.
   */
  it("gives EVERY entity an OCC token, at every depth", async () => {
    const [tree] = await getClientTrees(db, ["c_full"]);

    // A canonical token: UTC, microsecond precision. Anything else fails
    // If-Match even when present, so shape is asserted, not just truthiness.
    const TOKEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
    const missing: string[] = [];

    const check = (label: string, node: { _v?: unknown } | undefined) => {
      if (!node) return;
      if (typeof node._v !== "string" || !TOKEN.test(node._v)) {
        missing.push(`${label}: ${JSON.stringify(node._v)}`);
      }
    };

    check("client", tree);
    for (const i of tree.integrations ?? []) {
      check(`integration ${i.id}`, i);
      for (const m of i.milestones ?? []) check(`milestone ${m.id}`, m);
    }
    for (const m of tree.modules ?? []) {
      check(`module ${m.id}`, m);
      for (const p of m.phases ?? []) check(`phase ${p.id}`, p);
    }
    for (const w of tree.workLog ?? []) check(`work log ${w.id}`, w);

    expect(missing).toEqual([]);

    // And the walk must actually have visited children — otherwise this
    // passes vacuously the day the seed stops producing them.
    expect(tree.integrations?.[0]?.milestones?.length).toBeGreaterThan(0);
    expect(tree.modules?.[0]?.phases?.length).toBeGreaterThan(0);
    expect(tree.workLog?.length).toBeGreaterThan(0);
  });
});

describe("users — role shaping", () => {
  it("NEVER returns a password hash, in either shape", async () => {
    for (const role of ["admin", "viewer"]) {
      const blob = JSON.stringify(await listUsers(db, role));
      expect(blob).not.toContain("$2b$");
      expect(blob).not.toContain("passwordHash");
    }
  });

  it("gives a viewer only what an assignee dropdown needs", async () => {
    const rows = (await listUsers(db, "viewer")) as unknown as Record<
      string,
      unknown
    >[];
    expect(Object.keys(rows[0]).sort()).toEqual([
      "id",
      "name",
      "role",
      "username",
    ]);
    // No email, no lockout state.
    expect(rows[0].email).toBeUndefined();
    expect(rows[0].lockedUntil).toBeUndefined();
  });

  it("gives an admin the lockout state the admin screen needs", async () => {
    const rows = await listUsersForAdmin(db);
    const meera = rows.find((r) => r.username === "meera")!;
    expect(meera.email).toBe("m@example.com");
    expect(meera.failedAttempts).toBe(3);
    expect(meera.lockoutLevel).toBe(1);
    expect(meera.lockedUntil).toBeTruthy();
  });
});

describe("settings", () => {
  it("merges stored capacity weights over the defaults", async () => {
    // A partially-written row must not produce undefined weights, or the
    // bandwidth tile renders NaN.
    const w = await getCapacityWeights(db);
    expect(w.module).toBe(2); // stored
    expect(w.cap).toBe(4); // stored
    expect(w.pmo).toBe(DEFAULT_CAPACITY_WEIGHTS.pmo); // defaulted
    expect(w.ams).toBe(DEFAULT_CAPACITY_WEIGHTS.ams); // defaulted
  });

  it("returns the digest recipients", async () => {
    expect((await getDigestRecipients(db)).emails).toEqual([
      "ops@example.com",
      "pmo@example.com",
    ]);
  });
});

describe("snapshots — financial data", () => {
  it("omits ams_hours_month entirely for a non-admin", async () => {
    const rows = await listSnapshots(db, { isAdmin: false });
    expect(rows).toHaveLength(1);
    // Absent rather than null, so it cannot be misread as "no hours logged".
    expect("amsHoursMonth" in rows[0]).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("103.5");
  });

  it("includes it for an admin", async () => {
    const rows = await listSnapshots(db, { isAdmin: true });
    expect(rows[0].amsHoursMonth).toBe(103.5);
  });

  it("filters by date and client", async () => {
    expect(
      await listSnapshots(db, { isAdmin: true, from: "2026-09-01" }),
    ).toHaveLength(0);
    expect(
      await listSnapshots(db, { isAdmin: true, clientId: "nope" }),
    ).toHaveLength(0);
  });
});

describe("audit log", () => {
  it("returns newest first with a total for pagination", async () => {
    const res = await listAudit(db, {});
    expect(res.total).toBe(2);
    expect(res.rows).toHaveLength(2);
  });

  it("caps the page size, since the table is never pruned", async () => {
    expect((await listAudit(db, { limit: 99_999 })).limit).toBe(200);
    expect((await listAudit(db, { limit: 0 })).limit).toBe(1);
  });

  it("filters by user and by action text", async () => {
    expect((await listAudit(db, { user: "meera" })).total).toBe(1);
    expect((await listAudit(db, { q: "login" })).total).toBe(1); // case-insensitive
    expect((await listAudit(db, { q: "nothing-matches" })).total).toBe(0);
  });
});
