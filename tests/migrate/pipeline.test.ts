import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fromPglite, type Executor } from "@/scripts/migrate/lib/executor";
import { readV1Clients, readV2Snapshot } from "@/scripts/migrate/lib/read-v1";
import {
  planBackfill,
  applyBackfill,
  assertTallies,
} from "@/scripts/migrate/lib/backfill-core";
import { toV1Shape, mappedToV1Shape } from "@/lib/db/inverse";
import { SAMPLE_V1_CLIENTS } from "@/scripts/migrate/lib/sample-v1";

/**
 * End-to-end migration pipeline, against real Postgres (PGlite, in-process).
 *
 * Seeds hostile v1 data, runs the actual backfill code the CLI runs, then
 * proves the result is faithful by reconstructing v1 shape back out of v2 and
 * comparing. This is the "data intact" guarantee exercised as a test rather
 * than asserted in a document.
 */

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

/** The gate issues in the sample, fixed the way a human would fix them. */
function cleaned() {
  const clients = structuredClone(SAMPLE_V1_CLIENTS) as unknown as Array<
    Record<string, unknown>
  >;

  const aster = clients.find((c) => c.id === "c_aster")!;
  const integs = aster.integrations as Array<Record<string, unknown>>;
  // "TBD" -> a real date.
  integs.find((i) => i.id === "i_benefits")!.dueDate = "2026-09-18";

  const dupA = clients.find((c) => c.id === "c_dup_a")!;
  const mods = dupA.modules as Array<Record<string, unknown>>;
  const phases = mods[0].phases as Array<Record<string, unknown>>;
  // Duplicate "UAT" -> the real second phase; "Discovery" -> a valid phase.
  phases[1].name = "UAT Signoff";
  phases[2].name = "Go Live";

  // Case-insensitive duplicate client name -> renamed.
  clients.find((c) => c.id === "c_dup_b")!.name = "Vantage Logistics North";

  return clients;
}

async function seed(db: PGlite, clients: Array<Record<string, unknown>>) {
  await db.exec(`delete from clients`);
  for (const c of clients) {
    await db.query(
      `insert into clients (id, name, description, created_at, updated_at,
         integrations, modules, work_log, man_day_rate,
         total_available_hours, currency, master_assignee)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        c.id,
        c.name,
        c.description ?? "",
        c.created_at,
        c.updated_at,
        JSON.stringify(c.integrations ?? []),
        // The sentinel must survive the round trip through the database.
        c.modules === undefined ? null : JSON.stringify(c.modules),
        c.work_log === undefined ? null : JSON.stringify(c.work_log),
        c.man_day_rate ?? null,
        c.total_available_hours ?? null,
        c.currency ?? "INR",
        c.master_assignee ?? null,
      ],
    );
  }
}

describe("migration pipeline, end to end", () => {
  let db: PGlite;
  let exec: Executor;

  beforeAll(async () => {
    db = new PGlite();
    exec = fromPglite(db);
    await db.exec(`do $$ begin
      if not exists (select from pg_roles where rolname = 'service_role') then
        create role service_role;
      end if;
    end $$;`);
    for (const f of [
      "0001_baseline_v1_schema.sql",
      "0002_v2_schema.sql",
      "0003_domain_membership.sql",
      "0005_backend_indexes.sql",
    ]) {
      await db.exec(read(f));
    }
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  describe("preflight catches the problems before anything is written", () => {
    beforeAll(async () => {
      await seed(db, SAMPLE_V1_CLIENTS as unknown as Array<Record<string, unknown>>);
    });

    it("blocks, and names every planted defect", async () => {
      const clients = await readV1Clients(exec);
      const plan = planBackfill(clients);

      expect(plan.log.hasGates).toBe(true);
      const codes = new Set(plan.log.gates.map((g) => g.code));

      expect(codes).toContain("DATE_UNPARSEABLE"); // "TBD"
      expect(codes).toContain("PHASE_NAME_DUP"); // two UATs in one module
      expect(codes).toContain("PHASE_NAME_UNKNOWN"); // "Discovery"
    });

    it("reports the exact location of the bad date, so it can be fixed", async () => {
      const clients = await readV1Clients(exec);
      const plan = planBackfill(clients);
      const bad = plan.log.gates.find((g) => g.code === "DATE_UNPARSEABLE");
      expect(bad?.value).toBe("TBD");
      expect(bad?.location).toBe("c_aster/integrations[1].dueDate");
    });

    it("still records the transformations it would apply", async () => {
      const clients = await readV1Clients(exec);
      const counts = planBackfill(clients).log.counts();
      expect(counts.ID_REMINTED).toBeGreaterThan(0); // the `::` phase id
      expect(counts.ID_DERIVED).toBeGreaterThan(0); // id-less rows
      expect(counts.ATTACH_URL_STRIPPED).toBeGreaterThan(0);
      expect(counts.DATERAISED_FALLBACK).toBeGreaterThan(0);
    });
  });

  describe("backfill, on cleaned data", () => {
    let tallies: Awaited<ReturnType<typeof applyBackfill>>;

    beforeAll(async () => {
      await seed(db, cleaned());
      const clients = await readV1Clients(exec);
      const plan = planBackfill(clients);
      expect(plan.log.hasGates, "cleaned data must have no gates").toBe(false);
      tallies = await applyBackfill(exec, plan);
    });

    it("writes every row it planned", async () => {
      const clients = await readV1Clients(exec);
      const plan = planBackfill(clients);
      const check = await assertTallies(exec, plan.tallies);
      expect(check.diff).toEqual([]);
      expect(check.ok).toBe(true);
      expect(tallies.clients).toBe(5);
    });

    it("leaves no `::` synthetic ids anywhere", async () => {
      // These violate the app's own id validator, so a surviving one would be
      // a row the application could never save again.
      for (const t of ["phases_v2", "integrations_v2", "modules_v2"]) {
        const rows = await exec.query<{ n: string }>(
          `select count(*)::text as n from ${t} where id like '%::%'`,
        );
        expect(Number(rows[0].n), `${t} has synthetic ids`).toBe(0);
      }
    });

    it("stores no expired signed URLs, and a path for every attachment", async () => {
      const rows = await exec.query<{ activity_log: unknown }>(
        `select activity_log from integrations_v2
         union all select activity_log from phases_v2`,
      );
      const blob = JSON.stringify(rows);
      expect(blob).not.toContain("/storage/v1/object/sign/");
      expect(blob).not.toContain("/storage/v1/object/public/");
      // The one genuinely foreign URL is kept verbatim, by design.
      expect(blob).toContain("sharepoint.example.com");
    });

    it("stores activity logs as jsonb ARRAYS, not double-encoded strings", async () => {
      // Regression. The first version stringified jsonb params itself, and
      // postgres.js — which serializes json-bound params on its own — encoded
      // that string again, storing a jsonb scalar string instead of an array.
      // It still parsed as valid JSON, so a naive round-trip check passed while
      // every activity log in the database was the wrong shape. Caught only by
      // running the real driver; PGlite does not double-encode.
      for (const [table, column] of [
        ["integrations_v2", "activity_log"],
        ["phases_v2", "activity_log"],
        ["ams_work_log_v2", "edit_history"],
      ]) {
        const rows = await exec.query<{ n: string; kinds: string | null }>(
          `select count(*)::text as n,
                  string_agg(distinct jsonb_typeof(${column}), ',') as kinds
           from ${table}
           where jsonb_typeof(${column}) is distinct from 'array'`,
        );
        expect(
          Number(rows[0].n),
          `${table}.${column} holds ${rows[0].kinds} instead of array`,
        ).toBe(0);
      }
    });

    it("preserves v1 timestamps instead of stamping now()", async () => {
      const [row] = await exec.query<{ created_at: string; updated_at: string }>(
        `select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as created_at,
                to_char(updated_at at time zone 'UTC','YYYY-MM-DD') as updated_at
         from clients_v2 where id = 'c_aster'`,
      );
      expect(row.created_at).toBe("2026-01-15");
      expect(row.updated_at).toBe("2026-08-01");
    });

    it("gives the work-log entry with no dateRaised a real date", async () => {
      const [row] = await exec.query<{ date_raised: string }>(
        `select to_char(date_raised,'YYYY-MM-DD') as date_raised
         from ams_work_log_v2 where id = 'w2'`,
      );
      expect(row.date_raised).toBe("2026-07-22"); // from loggedAt
    });
  });

  describe("domain membership survives the migration", () => {
    it("keeps a zero-module client inside the Implementation domain", async () => {
      // The single most likely silent loss: this client has no modules, so a
      // row-count-based inference would drop it out of /implementation.
      const [row] = await exec.query<{
        has_implementation: boolean;
        has_ams: boolean;
        n: string;
      }>(
        `select c.has_implementation, c.has_ams,
                (select count(*)::text from modules_v2 m where m.client_id = c.id) as n
         from clients_v2 c where c.id = 'c_empty_impl'`,
      );
      expect(row.has_implementation).toBe(true);
      expect(row.has_ams).toBe(true);
      expect(Number(row.n)).toBe(0);
    });

    it("does not put an integrations-only client into other domains", async () => {
      const [row] = await exec.query<{
        has_implementation: boolean;
        has_ams: boolean;
      }>(
        `select has_implementation, has_ams from clients_v2 where id = 'c_integ_only'`,
      );
      expect(row.has_implementation).toBe(false);
      expect(row.has_ams).toBe(false);
    });
  });

  describe("inverse round-trip — the data-intact proof", () => {
    it("reconstructs each client from v2 and matches what was mapped from v1", async () => {
      // Deliberately goes back through DIFFERENT code from the forward path,
      // so a bug in the mapper cannot cancel itself out of the comparison.
      const clients = await readV1Clients(exec);
      const plan = planBackfill(clients);

      for (const mapped of plan.mapped) {
        const snap = await readV2Snapshot(exec, mapped.client.id);
        const fromDb = toV1Shape(snap);
        const fromPlan = mappedToV1Shape(mapped);
        expect(fromDb, `client ${mapped.client.id} diverged`).toEqual(fromPlan);
      }
    });

    it("round-trips the domain sentinel, not just the rows", async () => {
      const snapEmpty = await readV2Shape("c_empty_impl");
      expect("modules" in snapEmpty).toBe(true);
      expect(snapEmpty.modules).toEqual([]);

      const snapIntegOnly = await readV2Shape("c_integ_only");
      expect("modules" in snapIntegOnly).toBe(false);
      expect("workLog" in snapIntegOnly).toBe(false);

      async function readV2Shape(id: string) {
        return toV1Shape(await readV2Snapshot(exec, id));
      }
    });
  });

  describe("idempotency", () => {
    it("produces byte-identical rows when run a second time", async () => {
      // This is what makes the cutover safe to retry: a failed or interrupted
      // run can simply be run again.
      const snapshot = async () => {
        const out: Record<string, unknown> = {};
        for (const t of [
          "clients_v2", "integrations_v2", "milestones_v2",
          "modules_v2", "phases_v2", "ams_work_log_v2",
        ]) {
          out[t] = await exec.query(`select * from ${t} order by id`);
        }
        return JSON.stringify(out);
      };

      const before = await snapshot();

      const clients = await readV1Clients(exec);
      await applyBackfill(exec, planBackfill(clients));

      expect(await snapshot()).toBe(before);
    });
  });
});

describe("inverse shaping is key-convention agnostic", () => {
  /**
   * verify.ts reads with raw SQL (snake_case keys); the API reads through
   * Drizzle (camelCase keys). Both call toV1Shape. When it only understood
   * snake_case, the Drizzle path produced a structurally valid client with its
   * modules, work log and dates silently missing — no throw, no warning.
   */
  const snakeSnap = {
    client: {
      id: "c1", name: "Aster", description: "SAP", currency: "INR",
      master_assignee: "Arjun", man_day_rate: "8000",
      total_available_hours: "120", has_implementation: true, has_ams: true,
      archived: false,
    },
    integrations: [{
      id: "i1", client_id: "c1", name: "Payroll", status: "At Risk",
      due_date: "2026-09-02", next_action: "chase", effort_weight: "2",
      activity_log: [{ id: "t1", addedBy: "Meera", storagePath: "a/b.pdf" }],
      archived: false,
    }],
    milestones: [{
      id: "ms1", client_id: "c1", integration_id: "i1", name: "UAT",
      status: "Open", due_date: "2026-09-10", archived: false,
    }],
    modules: [{ id: "m1", client_id: "c1", name: "Core HR", archived: false }],
    phases: [{
      id: "p1", client_id: "c1", module_id: "m1", phase_name: "BPU",
      status: "Completed", target_date: "2026-03-01", start_date: "2026-01-05",
      current_activity: "done", next_action: "", activity_log: [], archived: false,
    }],
    workLog: [{
      id: "w1", client_id: "c1", date_raised: "2026-08-04", due_date: "2026-08-09",
      raised_by: "Kavya", description: "Leave accrual", entry_type: "Bug Fix",
      query_level: "L4 - Critical", entry_status: "Open", rag_status: "Amber",
      mode_of_support: "Remote", hours: "6.5", edit_history: [], archived: false,
    }],
  };

  const toCamel = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        v,
      ]),
    );

  it("produces identical output from camelCase and snake_case rows", () => {
    const camelSnap = {
      client: toCamel(snakeSnap.client),
      integrations: snakeSnap.integrations.map(toCamel),
      milestones: snakeSnap.milestones.map(toCamel),
      modules: snakeSnap.modules.map(toCamel),
      phases: snakeSnap.phases.map(toCamel),
      workLog: snakeSnap.workLog.map(toCamel),
    };
    expect(JSON.stringify(toV1Shape(camelSnap))).toBe(
      JSON.stringify(toV1Shape(snakeSnap)),
    );
  });

  it("actually populates the fields that were silently dropped", () => {
    // Guards against both sides being equally empty, which would make the
    // equality assertion above pass while proving nothing.
    const out = toV1Shape({
      client: toCamel(snakeSnap.client),
      integrations: snakeSnap.integrations.map(toCamel),
      milestones: snakeSnap.milestones.map(toCamel),
      modules: snakeSnap.modules.map(toCamel),
      phases: snakeSnap.phases.map(toCamel),
      workLog: snakeSnap.workLog.map(toCamel),
    });
    expect(out.modules?.[0]?.phases?.[0]?.name).toBe("BPU");
    expect(out.workLog?.[0]?.dateRaised).toBe("2026-08-04");
    expect(out.integrations?.[0]?.dueDate).toBe("2026-09-02");
    expect(out.integrations?.[0]?.effortWeight).toBe(2);
    expect(out.integrations?.[0]?.milestones?.[0]?.name).toBe("UAT");
    expect(out.masterAssignee).toBe("Arjun");
  });

  it("leaves jsonb payload keys alone", () => {
    // Normalization is shallow: `addedBy` and `storagePath` inside activity_log
    // are stored data, not column names. Rewriting them would corrupt exactly
    // the values being reconstructed.
    const out = toV1Shape({ ...snakeSnap, client: toCamel(snakeSnap.client) });
    expect(out.integrations?.[0]?.timeline?.[0]).toEqual({
      id: "t1", addedBy: "Meera", storagePath: "a/b.pdf",
    });
  });
});
