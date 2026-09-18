/**
 * peek — what does the data actually look like?
 *
 *   pnpm peek                 # the local dev database
 *   pnpm peek --prod          # the live Supabase project (READ ONLY)
 *   pnpm peek --prod --compare  # ...and diff v1 jsonb against v2 counts
 *   pnpm peek --client Aster  # drill into one client, by name or id
 *
 * Read-only by construction: every statement here is a SELECT, and the
 * connection is opened without any write path. Safe to point at production,
 * which is the point — "what is actually in there" is a question worth being
 * able to answer in one command rather than by assembling psql incantations.
 *
 * Defaults to LOCAL. Reaching production takes an explicit --prod, and the
 * banner says which one you got in large letters, because the two look
 * identical once you are reading rows.
 */
import postgres from "postgres";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const argv = process.argv.slice(2);
const useProd = argv.includes("--prod");
// Opt-in. The v1-vs-v2 comparison exists to build confidence DURING the
// migration; once you trust it, it is noise on every run of a command whose
// job is to show you what the new app reads.
const useCompare = argv.includes("--compare");
const clientArg = (() => {
  const i = argv.indexOf("--client");
  return i >= 0 ? argv[i + 1] : undefined;
})();

const pad = (s: unknown, n: number) => String(s ?? "").padEnd(n);
const num = (s: unknown, n: number) => String(s ?? "").padStart(n);

/**
 * Renders a `date` column as YYYY-MM-DD.
 *
 * postgres.js hands back a JS `Date` for a `date` column, and stringifying one
 * naively gives "Thu Jul 23 2026 05:30:00 GMT+0530 (India Standard Time)".
 * The same trap corrupted every date in the migration comparison until
 * `dateStr()` in lib/db/inverse.ts closed it — worth the four lines here too,
 * since a date column that reads as a local-timezone timestamp is exactly the
 * sort of thing you squint at and then trust.
 *
 * UTC components: a Postgres `date` has no time and no zone, and the driver
 * materialises it at UTC midnight, so local formatting shifts the day
 * backwards for anyone east of Greenwich.
 */
const day = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const rule = (label = "") =>
  console.log(`\n${label ? `── ${label} ` : ""}${"─".repeat(Math.max(0, 68 - label.length))}`);

async function main() {
  const url = useProd
    ? process.env.MIGRATION_DATABASE_URL
    : process.env.DATABASE_URL;

  if (!url) {
    console.error(
      `\n  ${useProd ? "MIGRATION_DATABASE_URL" : "DATABASE_URL"} is not set.\n`,
    );
    process.exit(1);
  }

  const host = new URL(url).hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");

  console.log(`\n${"═".repeat(70)}`);
  console.log(
    `  ${isLocal ? "LOCAL DEV DATABASE — fabricated data" : "*** PRODUCTION — REAL CLIENT DATA ***"}`,
  );
  console.log(`  ${host}${new URL(url).pathname}`);
  console.log(`  read-only`);
  console.log("═".repeat(70));

  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: isLocal ? false : "require",
    onnotice: () => {},
  });

  try {
    /* ---------------------------------------------------------- counts --- */
    rule("row counts");
    const counts = await sql`
      select 'clients'      as t, count(*) as all_rows,
             count(*) filter (where archived) as archived from clients_v2
      union all select 'integrations', count(*), count(*) filter (where archived) from integrations_v2
      union all select 'milestones',   count(*), count(*) filter (where archived) from milestones_v2
      union all select 'modules',      count(*), count(*) filter (where archived) from modules_v2
      union all select 'phases',       count(*), count(*) filter (where archived) from phases_v2
      union all select 'work log',     count(*), count(*) filter (where archived) from ams_work_log_v2`;

    console.log(`  ${pad("table", 14)}${num("rows", 7)}${num("archived", 10)}`);
    for (const r of counts) {
      console.log(`  ${pad(r.t, 14)}${num(r.all_rows, 7)}${num(r.archived, 10)}`);
    }

    /* ------------------------------------------- v1 vs v2, production ---- */
    if (useProd && useCompare) {
      rule("v1 (live app) vs v2 (what the new app reads)");
      const cmp = await sql`
        select
          (select count(*) from clients)                                          as v1_clients,
          (select count(*) from clients_v2 where archived = false)                 as v2_clients,
          (select coalesce(sum(jsonb_array_length(integrations)),0) from clients)  as v1_integs,
          (select count(*) from integrations_v2 where archived = false)            as v2_integs,
          (select coalesce(sum(jsonb_array_length(coalesce(modules,'[]'::jsonb))),0) from clients) as v1_mods,
          (select count(*) from modules_v2 where archived = false)                 as v2_mods`;
      const c = cmp[0];
      const line = (label: string, a: unknown, b: unknown) =>
        console.log(
          `  ${pad(label, 14)}${num(a, 7)}${num(b, 7)}   ${String(a) === String(b) ? "match" : "DIFFERENT"}`,
        );
      console.log(`  ${pad("", 14)}${num("v1", 7)}${num("v2", 7)}`);
      line("clients", c.v1_clients, c.v2_clients);
      line("integrations", c.v1_integs, c.v2_integs);
      line("modules", c.v1_mods, c.v2_mods);
      console.log(
        "\n  A difference here is not automatically wrong — v1 counts every row in\n" +
          "  the jsonb, v2 counts unarchived rows. Run `pnpm migrate:verify` for the\n" +
          "  real proof; this is a glance, not a gate.",
      );
    }

    /* ------------------------------------------------ domain membership -- */
    rule("domain membership");
    const dom = await sql`
      select
        count(*) filter (where has_implementation) as impl,
        count(*) filter (where has_ams)            as ams,
        count(*) filter (where has_implementation and not exists (
          select 1 from modules_v2 m where m.client_id = c.id and not m.archived)) as impl_empty,
        count(*) filter (where has_ams and not exists (
          select 1 from ams_work_log_v2 w where w.client_id = c.id and not w.archived)) as ams_empty
      from clients_v2 c where not archived`;
    const d = dom[0];
    console.log(`  in Implementation : ${d.impl}   (${d.impl_empty} with zero modules)`);
    console.log(`  in AMS            : ${d.ams}   (${d.ams_empty} with an empty work log)`);
    console.log(
      "\n  The zero-count ones are the null-sentinel clients. They are IN the domain\n" +
        "  with nothing in it, and they vanished from the domain view until\n" +
        "  migration 0003 gave them an explicit flag.",
    );

    /* -------------------------------------------------------- clients ---- */
    rule(clientArg ? `client matching "${clientArg}"` : "clients");
    const clients = clientArg
      ? await sql`
          select c.id, c.name, c.currency, c.has_implementation, c.has_ams,
                 c.master_assignee, c.man_day_rate, c.total_available_hours
          from clients_v2 c
          where not c.archived and (c.id = ${clientArg} or c.name ilike ${"%" + clientArg + "%"})
          order by c.name`
      : await sql`
          select c.id, c.name, c.currency, c.has_implementation, c.has_ams,
                 c.master_assignee, c.man_day_rate, c.total_available_hours
          from clients_v2 c where not c.archived order by c.name limit 30`;

    if (!clients.length) {
      console.log("  (no match)");
    } else {
      // "domain" is which trackers a client appears in at all -- the thing
      // migration 0003 made explicit. A client can be in a domain with nothing
      // in it, which is why this is a stored flag and not a count.
      console.log("  domain = which trackers this client appears in\n");
      console.log(
        `  ${pad("name", 34)}${pad("domain", 10)}${pad("cur", 5)}${pad("master assignee", 20)}`,
      );
      for (const c of clients) {
        const dom = c.has_implementation
          ? c.has_ams
            ? "Impl+AMS"
            : "Impl"
          : c.has_ams
            ? "AMS"
            : "—";
        console.log(
          `  ${pad(String(c.name).slice(0, 32), 34)}${pad(dom, 10)}${pad(c.currency, 5)}${pad(c.master_assignee ?? "—", 20)}`,
        );
      }
      if (!clientArg && clients.length === 30) console.log("  … (first 30)");
    }

    /* ---------------------------------------------- one client, in full -- */
    if (clientArg && clients.length === 1) {
      const id = clients[0].id as string;

      rule("integrations");
      const integs = await sql`
        select name, status, assignee, due_date,
               jsonb_array_length(activity_log) as updates
        from integrations_v2 where client_id = ${id} and not archived order by name`;
      if (!integs.length) console.log("  (none)");
      for (const i of integs) {
        console.log(
          `  ${pad(String(i.name).slice(0, 38), 40)}${pad(i.status, 16)}${pad(i.assignee ?? "—", 16)}${pad(day(i.due_date), 12)}${num(i.updates, 3)} updates`,
        );
      }

      rule("modules and phase status");
      const mods = await sql`
        select m.name as module, p.phase_name, p.status, p.assignee
        from modules_v2 m
        join phases_v2 p on p.module_id = m.id and not p.archived
        where m.client_id = ${id} and not m.archived
        order by m.name, p.phase_name`;
      let lastModule = "";
      for (const p of mods) {
        if (p.module !== lastModule) {
          console.log(`  ${p.module}`);
          lastModule = String(p.module);
        }
        console.log(
          `    ${pad(String(p.phase_name).slice(0, 38), 40)}${pad(p.status, 18)}${p.assignee ?? "—"}`,
        );
      }
      if (!mods.length) console.log("  (no modules)");

      rule("AMS work log");
      const wl = await sql`
        select date_raised, entry_type, query_level, entry_status, hours,
               left(description, 46) as description
        from ams_work_log_v2 where client_id = ${id} and not archived
        order by date_raised desc limit 15`;
      if (!wl.length) console.log("  (none)");
      for (const w of wl) {
        console.log(
          `  ${pad(day(w.date_raised), 12)}${pad(w.entry_status, 13)}${pad(w.query_level ?? "—", 16)}${num(w.hours, 6)}h  ${w.description ?? ""}`,
        );
      }
    }

    /* ---------------------------------------------------- attachments ---- */
    rule("attachments");
    const att = await sql`
      select count(*)::int as n from (
        select e from integrations_v2, jsonb_array_elements(activity_log) e where e ? 'attachment'
        union all
        select e from phases_v2, jsonb_array_elements(activity_log) e where e ? 'attachment'
      ) x`;
    console.log(`  activity entries carrying a file: ${att[0].n}`);

    /* ---------------------------------------------------------- users ---- */
    rule("users");
    const users = await sql`
      select role, count(*)::int as n from users group by role order by role`;
    for (const u of users) console.log(`  ${pad(u.role, 10)}${num(u.n, 4)}`);
    console.log("\n  (password hashes are never selected by this script)");

    rule();
    console.log(
      clientArg
        ? ""
        : "  Drill into one:  pnpm peek --client <name>\n" +
          "  The live data  :  pnpm peek --prod\n",
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\n  peek failed:\n");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
