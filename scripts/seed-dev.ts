/**
 * seed-dev — a local database with realistic tracker data.
 *
 *   brew services start postgresql@17 && createdb kora_dev
 *   pnpm seed:dev
 *
 * `seed-auth-dev.ts` gives you accounts to sign in as; this gives you
 * something to look at once you have. Together they make the app fully
 * runnable with no connection to production.
 *
 * WHY NOT JUST POINT AT PRODUCTION. Building screens means creating and
 * deleting records dozens of times an hour, and the v1 app is still live on
 * that data with colleagues using it. Test records would appear in their
 * client list and their audit log.
 *
 * The data is generated through the SAME mapper the real migration uses
 * (`planBackfill` -> `applyBackfill`), rather than hand-written INSERTs. That
 * means the local database has the exact shape the production one does — if
 * the mapper produces something the UI cannot render, it shows up here first
 * rather than at cutover.
 *
 * Refuses to run against anything that is not local.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { config as loadEnv } from "dotenv";
import { makeClients } from "../tests/golden/fixtures";
import { planBackfill, applyBackfill } from "./migrate/lib/backfill-core";
import { fromPostgresJs } from "./migrate/lib/executor";
import { PHASES } from "../lib/domain/constants";
import type { Client, Module } from "../lib/domain/types";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const MIGRATIONS = [
  "0001_baseline_v1_schema.sql",
  "0002_v2_schema.sql",
  "0003_domain_membership.sql",
  "0004_client_name_ci_unique.sql",
  "0005_backend_indexes.sql",
  "0006_updated_at_trigger.sql",
];

const BASE = new Date();

/**
 * Cases the generator does not produce, each here because it is a real shape
 * from production or a known way to break a layout.
 */
function edgeCases(): Client[] {
  // No `id` on purpose. All 702 phases in production v1 lack one — the mapper
  // derives `ph_<sha256(moduleId ∅ phaseName)>` instead — so hand-writing ids
  // here would be less faithful AND would collide between the two edge-case
  // clients that both call this.
  const phases = (statuses: string[]) =>
    PHASES.map((name, n) => ({
      name,
      status: statuses[n % statuses.length],
      updates: [],
    }));

  return [
    {
      // The null-sentinel: in the Implementation domain with nothing in it.
      // Six real clients look like this, and they vanished from the domain
      // view until migration 0003 existed. The rail must still list them.
      id: "edge_empty_impl",
      name: "Swastik Consulting",
      description: "In Implementation, no modules yet",
      currency: "INR",
      integrations: [],
      modules: [],
    },
    {
      // In AMS with an empty work log — same sentinel, other domain.
      id: "edge_empty_ams",
      name: "Anand Enterprises",
      description: "On retainer, nothing logged",
      currency: "INR",
      integrations: [],
      workLog: [],
      totalAvailableHours: 40,
      manDayRate: 12000,
    },
    {
      // A name long enough to break a 268px rail and a breadcrumb.
      id: "edge_long_name",
      name: "Interglobe Aviation Technologies and Digital Transformation Services Private Limited",
      description:
        "Deliberately long, to catch truncation that only shows up on the widest real client name.",
      currency: "INR",
      integrations: [
        {
          id: "edge_i1",
          name: "Payroll → SAP posting with an unusually long integration title",
          status: "At Risk",
          assignee: "Kavya Iyer",
          dueDate: "2020-01-01", // very overdue, exercises the overdue badge
          description: "",
          nextAction: "Chase finance for the GL mapping",
          milestones: [],
          timeline: [],
        },
      ],
    },
    {
      // Every phase in a status the funnel must NOT count — the regression
      // that was live in lib/domain until this week.
      id: "edge_parked",
      name: "Parked Programme",
      description: "Nothing in flight",
      currency: "INR",
      integrations: [],
      modules: [
        {
          id: "edge_m_parked",
          name: "Core HR",
          phases: phases([
            "On Hold — Client", "Delayed", "Under Review",
            "Pending Client", "Cancelled", "Not Started",
          ]),
        },
      ],
    },
    {
      // In all three domains at once, which is what most real clients are.
      id: "edge_all_three",
      name: "Aster Retail Group",
      description: "Integrations, Implementation and AMS",
      currency: "USD",
      masterAssignee: "Arjun Mehta",
      manDayRate: 900,
      totalAvailableHours: 120,
      integrations: [
        {
          id: "edge_i2", name: "Attendance sync", status: "In Progress",
          assignee: "Arjun Mehta", description: "", nextAction: "",
          milestones: [
            { id: "edge_ms1", name: "UAT sign-off", status: "Pending",
              dueDate: new Date(BASE.getTime() + 3 * 86400000).toISOString().slice(0, 10),
              owner: "Kavya Iyer", notes: "" },
          ],
          timeline: [],
        },
      ],
      modules: [
        { id: "edge_m1", name: "Core HR", phases: phases(["Completed", "In Progress", "At Risk"]) },
      ],
      workLog: [
        {
          id: "edge_w1",
          dateRaised: new Date(BASE.getTime() - 40 * 86400000).toISOString().slice(0, 10),
          description: "Leave accrual mis-calculating for mid-month joiners",
          type: "Bug Fix", queryLevel: "L4 - Critical", entryStatus: "Open",
          hours: 6.5, raisedBy: "Kavya Iyer",
          dependencies: "Waiting on the client's payroll vendor to confirm the cutoff rule",
          solution: "", edits: [],
        },
      ],
    },
    {
      // Nothing at all — the empty state on every screen.
      id: "edge_bare",
      name: "Zephyr Holdings",
      description: "Onboarded, nothing tracked yet",
      currency: "INR",
      integrations: [],
    },
  ] as unknown as Client[];
}

/**
 * Makes child ids globally unique.
 *
 * The fixture generator numbers ids from zero WITHIN each client — `i0`, `m0`,
 * `w0` — which is a faithful reproduction of v1, where an id only ever had to
 * be unique inside one client's jsonb array. v2 makes every id a global
 * primary key, and that mismatch is exactly what `migrate:preflight` gates on.
 *
 * Production survives it by accident: `uid()` is timestamp-based, so real ids
 * are globally unique in practice. The generator's are not, so they are
 * namespaced here — otherwise the seed dies on a duplicate key that says
 * nothing about the app.
 */
function namespaceIds(c: Client): Client {
  const pre = (id: string) => `${c.id}_${id}`;
  return {
    ...c,
    integrations: (c.integrations ?? []).map((i) => ({
      ...i,
      id: pre(i.id),
      milestones: (i.milestones ?? []).map((m) => ({ ...m, id: pre(m.id) })),
    })),
    ...(c.modules !== undefined
      ? {
          modules: c.modules.map((m) => ({
            ...m,
            id: pre(m.id),
            // Phase ids are STRIPPED, not namespaced. The generator gives them
            // per-client ids (`p0`, `p1`...) which the mapper keeps because
            // they are structurally valid — and which then collide globally.
            // Production has no phase ids at all, so removing them here both
            // fixes the collision and matches what the real migration sees:
            // the mapper derives `ph_<sha256(moduleId ∅ phaseName)>`.
            // Cast because `Phase.id` is required on the API-facing type but
            // genuinely absent in v1 input — which is the whole point here.
            phases: (m.phases ?? []).map((ph) => {
              const copy: Record<string, unknown> = { ...ph };
              delete copy.id;
              return copy;
            }) as unknown as Module["phases"],
          })),
        }
      : {}),
    ...(c.workLog !== undefined
      ? { workLog: c.workLog.map((w) => ({ ...w, id: pre(w.id) })) }
      : {}),
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "\n  DATABASE_URL is not set.\n\n" +
        "    brew services start postgresql@17\n" +
        "    createdb kora_dev\n" +
        "    # then set DATABASE_URL in .env.local\n",
    );
    process.exit(1);
  }

  const host = new URL(url).hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");

  if (!isLocal) {
    console.error(
      `\n  REFUSING TO RUN — target is ${host}, which is not local.\n` +
        "  This TRUNCATES every v2 table and replaces the contents with\n" +
        "  fabricated data. It must never point at a real database.\n",
    );
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const exec = fromPostgresJs(sql);

  try {
    console.log(`\n  Target: ${host}/${new URL(url).pathname.slice(1)} (local)\n`);

    // Supabase provides this role; stock Postgres does not, and 0005 grants
    // to it. Creating it lets the migration files apply unmodified.
    await sql.unsafe(`
      do $$ begin
        if not exists (select from pg_roles where rolname = 'service_role') then
          create role service_role;
        end if;
      end $$;`);

    for (const file of MIGRATIONS) {
      const text = fs.readFileSync(
        path.resolve(process.cwd(), "db/migrations", file), "utf8",
      );
      await sql.unsafe(text);
      console.log(`  applied  ${file}`);
    }

    // One generator run plus the hand-written edge cases. One run, not two:
    // makeClient numbers its ids from zero, so a second seed collides on the
    // primary key rather than adding variety — the per-client randomness
    // already comes from the shared RNG.
    //
    // Timestamps are stamped here rather than in the fixture generator: the
    // golden tests do not care about them, and adding them there would change
    // what a dozen parity tests are comparing for no benefit. The mapper needs
    // them because real v1 rows have them and the columns are NOT NULL.
    const clients = [
      ...edgeCases(),
      ...makeClients(7, 20, BASE),
    ].map(namespaceIds).map((c, n) => ({
      ...c,
      // Spread over the past year so "recently created" ordering is not all
      // one instant, and so createdAt is always before updatedAt.
      createdAt: new Date(BASE.getTime() - (365 - n) * 86400000).toISOString(),
      updatedAt: new Date(BASE.getTime() - (n % 30) * 86400000).toISOString(),
    })) as Client[];

    const plan = planBackfill(clients);
    const written = await applyBackfill(exec, plan);

    await sql`
      insert into app_settings (key, value) values
        ('capacity_weights', ${sql.json({ module: 1, pmo: 0.5, ams: 0.25, cap: 5 })}),
        ('digest_recipients', ${sql.json({ emails: ["ops@example.com"] })})
      on conflict (key) do update set value = excluded.value`;

    // Two snapshots per client, a fortnight apart, so the health scorecard's
    // trend arrows have something to compare. Deliberately mixed directions.
    const ids = clients.map((c) => c.id);
    const old = new Date(BASE.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const recent = new Date(BASE.getTime() - 1 * 86400000).toISOString().slice(0, 10);
    const rags = ["Red", "Amber", "Green"];
    await sql`delete from portfolio_snapshots`;
    for (const [n, id] of ids.entries()) {
      const c = clients[n];
      for (const [k, date] of [[0, old], [1, recent]] as const) {
        await sql`
          insert into portfolio_snapshots (snapshot_date, client_id, client_name, overall_rag)
          values (${date}, ${id}, ${c.name}, ${rags[(n + k * (n % 3)) % 3]})
          on conflict (snapshot_date, client_id) do nothing`;
      }
    }

    console.log("\n  Seeded:");
    for (const [k, v] of Object.entries(written)) {
      console.log(`    ${k.padEnd(14)} ${v}`);
    }
    console.log(`    snapshots      ${ids.length * 2}`);

    const gates = plan.log.issues.filter((i) => i.severity === "gate");
    if (gates.length) {
      console.log(`\n  ${gates.length} mapping gate(s) in the generated data:`);
      for (const g of gates.slice(0, 5)) console.log(`    ${g.code} at ${g.location}`);
    }

    console.log("\n  Now run:  pnpm tsx scripts/seed-auth-dev.ts\n");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\n  seed-dev failed:\n");
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
