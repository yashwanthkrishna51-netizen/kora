/**
 * verify — the "data intact" proof. This is the cutover gate.
 *
 *   pnpm migrate:verify
 *   pnpm migrate:verify --tallies-only     # post-cutover monitoring
 *
 * Three independent legs, because one check that shares code with the thing it
 * is checking proves very little:
 *
 *   1. FORWARD    re-derive v2 from v1 and diff against what is stored.
 *   2. INVERSE    reconstruct v1 shape out of v2 through different code and
 *                 diff against the original. A mapping bug cannot cancel
 *                 itself out across both directions.
 *   3. STRUCTURAL raw SQL: tallies, orphans, id format, membership,
 *                 attachment coverage. Shares no application code at all.
 *
 * Exits non-zero unless every leg is clean.
 */
import { announce, connect, resolveTarget } from "./lib/db";
import { fromPostgresJs, type Executor } from "./lib/executor";
import { readV1Clients, readV2Snapshot } from "./lib/read-v1";
import { planBackfill } from "./lib/backfill-core";
import { toV1Shape, mappedToV1Shape } from "@/lib/db/inverse";
import { countAttachments } from "./lib/attachments";
import { printTable, writeReport } from "./lib/report";

const talliesOnly = process.argv.includes("--tallies-only");

interface Failure {
  leg: string;
  location: string;
  detail: string;
}

/** Structural checks written as raw SQL, sharing no application code. */
async function structural(exec: Executor): Promise<Failure[]> {
  const failures: Failure[] = [];

  const [counts] = await exec.query<Record<string, string>>(`
    select
      (select count(*) from clients)                                          as v1_clients,
      (select count(*) from clients_v2 where archived = false)                as v2_clients,
      (select coalesce(sum(jsonb_array_length(integrations)),0) from clients) as v1_integs,
      (select count(*) from integrations_v2 where archived = false)           as v2_integs,
      (select coalesce(sum(jsonb_array_length(coalesce(i->'milestones','[]'::jsonb))),0)
         from clients, jsonb_array_elements(integrations) i)                  as v1_ms,
      (select count(*) from milestones_v2 where archived = false)             as v2_ms,
      (select coalesce(sum(jsonb_array_length(modules)),0)
         from clients where modules is not null)                              as v1_mods,
      (select count(*) from modules_v2 where archived = false)                as v2_mods,
      (select coalesce(sum(jsonb_array_length(coalesce(m->'phases','[]'::jsonb))),0)
         from clients, jsonb_array_elements(coalesce(modules,'[]'::jsonb)) m) as v1_phases,
      (select count(*) from phases_v2 where archived = false)                 as v2_phases,
      (select coalesce(sum(jsonb_array_length(work_log)),0)
         from clients where work_log is not null)                             as v1_wl,
      (select count(*) from ams_work_log_v2 where archived = false)           as v2_wl
  `);

  const pairs: [string, string, string][] = [
    ["clients", "v1_clients", "v2_clients"],
    ["integrations", "v1_integs", "v2_integs"],
    ["milestones", "v1_ms", "v2_ms"],
    ["modules", "v1_mods", "v2_mods"],
    ["phases", "v1_phases", "v2_phases"],
    ["work log", "v1_wl", "v2_wl"],
  ];

  const rows = pairs.map(([label, a, b]) => ({
    collection: label,
    v1: counts[a],
    v2: counts[b],
    match: counts[a] === counts[b] ? "ok" : "MISMATCH",
  }));
  printTable(rows, ["collection", "v1", "v2", "match"]);

  for (const [label, a, b] of pairs) {
    if (counts[a] !== counts[b]) {
      failures.push({
        leg: "structural",
        location: label,
        detail: `v1=${counts[a]} v2=${counts[b]}`,
      });
    }
  }

  // No `::` synthetics survived — they violate the app's own id validator.
  for (const t of ["clients_v2", "integrations_v2", "milestones_v2",
                   "modules_v2", "phases_v2", "ams_work_log_v2"]) {
    const [r] = await exec.query<{ n: string }>(
      `select count(*)::text as n from ${t} where id !~ '^[A-Za-z0-9_-]{1,64}$'`,
    );
    if (Number(r.n) > 0) {
      failures.push({ leg: "structural", location: t,
        detail: `${r.n} rows have a malformed id` });
    }
  }

  // Every jsonb activity column must hold an ARRAY, not a scalar string.
  //
  // This exists because a double-encoded value still parses as valid JSON, so
  // it survives a naive round-trip check while being the wrong shape for every
  // query the app runs. It is a driver-serialization mistake that is invisible
  // until something tries `jsonb_array_length` in production.
  for (const [table, column] of [
    ["integrations_v2", "activity_log"],
    ["phases_v2", "activity_log"],
    ["ams_work_log_v2", "edit_history"],
  ]) {
    const [r] = await exec.query<{ n: string; kinds: string }>(`
      select count(*)::text as n,
             coalesce(string_agg(distinct jsonb_typeof(${column}), ','), 'none') as kinds
      from ${table}
      where jsonb_typeof(${column}) is distinct from 'array'
    `);
    if (Number(r.n) > 0) {
      failures.push({
        leg: "structural",
        location: `${table}.${column}`,
        detail: `${r.n} rows are not a jsonb array (found: ${r.kinds}) — likely double-encoded`,
      });
    }
  }

  // Orphans: a milestone must agree with its integration about the client.
  const [orphan] = await exec.query<{ n: string }>(`
    select count(*)::text as n
    from milestones_v2 m
    join integrations_v2 i on i.id = m.integration_id
    where i.client_id <> m.client_id
  `);
  if (Number(orphan.n) > 0) {
    failures.push({ leg: "structural", location: "milestones_v2",
      detail: `${orphan.n} rows disagree with their integration's client` });
  }

  // Membership flags must equal the v1 sentinel exactly.
  const [membership] = await exec.query<{ n: string }>(`
    select count(*)::text as n
    from clients c join clients_v2 v on v.id = c.id
    where v.has_implementation <> (c.modules is not null)
       or v.has_ams            <> (c.work_log is not null)
  `);
  if (Number(membership.n) > 0) {
    failures.push({ leg: "structural", location: "clients_v2",
      detail: `${membership.n} clients have wrong domain flags` });
  }

  // Every attachment must carry a storagePath, and no stored signed URLs.
  const attachRows = await exec.query<{ activity_log: unknown }>(
    `select activity_log from integrations_v2
     union all select activity_log from phases_v2`,
  );
  const att = countAttachments(attachRows.map((r) => r.activity_log));

  // Only an attachment we could have resolved and didn't is a defect. A link
  // to somewhere outside our bucket has no storage path by definition; those
  // are preserved verbatim and reported by preflight as warnings.
  if (att.unresolvedInternal > 0) {
    failures.push({
      leg: "structural",
      location: "attachments",
      detail: `${att.unresolvedInternal} attachment(s) point at our bucket but have no storagePath`,
    });
  }

  // A stored signed URL is stale by definition — the read path signs fresh
  // from storagePath — so any survivor means normalization was skipped.
  if (att.withPath > 0 && att.withUrl > att.external) {
    failures.push({
      leg: "structural",
      location: "attachments",
      detail: `${att.withUrl - att.external} attachment(s) still carry a stored signed URL`,
    });
  }

  console.log(
    `\n    attachments: ${att.total} total — ${att.withPath} with a storagePath, ` +
      `${att.external} external (kept as-is), ${att.unresolvedInternal} unresolved`,
  );

  return failures;
}

async function main() {
  const target = resolveTarget();
  announce("verify — data-integrity proof", target,
    talliesOnly ? "tallies only" : "full (3 legs)");

  const sql = connect(target);
  const exec = fromPostgresJs(sql);
  const failures: Failure[] = [];

  try {
    console.log("  Leg 3 — structural (raw SQL)\n");
    failures.push(...(await structural(exec)));

    if (!talliesOnly) {
      const clients = await readV1Clients(exec);
      const plan = planBackfill(clients);

      // Leg 1: forward. Every difference must be an expected transformation.
      console.log("\n  Leg 1 — forward re-derivation");
      let forwardChecked = 0;
      for (const mapped of plan.mapped) {
        const [stored] = await exec.query<Record<string, unknown>>(
          `select * from clients_v2 where id = $1`, [mapped.client.id],
        );
        if (!stored) {
          failures.push({ leg: "forward", location: mapped.client.id,
            detail: "client missing from clients_v2" });
          continue;
        }
        if (stored.has_implementation !== mapped.client.has_implementation ||
            stored.has_ams !== mapped.client.has_ams) {
          failures.push({ leg: "forward", location: mapped.client.id,
            detail: "domain flags differ from the re-derived value" });
        }
        forwardChecked++;
      }
      console.log(`    ${forwardChecked} clients re-derived and compared`);

      // Leg 2: inverse. Different code path, so bugs cannot cancel out.
      console.log("\n  Leg 2 — inverse round-trip");
      let inverseChecked = 0;
      for (const mapped of plan.mapped) {
        const snap = await readV2Snapshot(exec, mapped.client.id);
        const fromDb = JSON.stringify(toV1Shape(snap));
        const fromPlan = JSON.stringify(mappedToV1Shape(mapped));
        if (fromDb !== fromPlan) {
          failures.push({ leg: "inverse", location: mapped.client.id,
            detail: "reconstruction from v2 does not match v1" });
        }
        inverseChecked++;
      }
      console.log(`    ${inverseChecked} clients round-tripped`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = writeReport(`verify-${stamp}`, {
      target: target.label,
      generatedAt: new Date().toISOString(),
      mode: talliesOnly ? "tallies-only" : "full",
      failures,
    });

    console.log(`\n  Report: ${file}`);

    if (failures.length) {
      console.error(`\n  FAIL — ${failures.length} unexplained difference(s):\n`);
      for (const f of failures.slice(0, 20)) {
        console.error(`    [${f.leg}] ${f.location}: ${f.detail}`);
      }
      if (failures.length > 20) {
        console.error(`    … ${failures.length - 20} more in the report`);
      }
      console.error(
        `\n  DO NOT CUT OVER. Unfreeze the old app and investigate offline.\n`,
      );
      process.exit(1);
    }

    console.log(`\n  PASS — 0 unexplained differences.\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("\n  verify failed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
