/**
 * check-membership — verifies the domain flags against the v1 null-sentinel.
 *
 *   pnpm tsx scripts/migrate/check-membership.ts
 *
 * Focused on the single most likely silent loss in this migration: a client
 * that belongs to the Implementation or AMS domain but has no rows in it. In v1
 * that state is expressed by the jsonb column being present-but-empty; v2 can
 * only express it with an explicit flag. If the flag is wrong, the client
 * quietly stops appearing in that domain's view — nothing errors, nothing is
 * deleted, and the first you hear of it is from a user.
 *
 * Read-only.
 */
import { announce, connect, resolveTarget } from "./lib/db";
import { printTable } from "./lib/report";

async function main() {
  const target = resolveTarget();
  announce("check-membership", target, "read-only");

  const sql = connect(target);
  try {
    const mismatches = await sql<{ id: string; name: string; detail: string }[]>`
      select c.id, c.name,
             format('v1 modules %s / flag %s ; v1 work_log %s / flag %s',
                    (c.modules  is not null), v.has_implementation,
                    (c.work_log is not null), v.has_ams) as detail
      from clients c join clients_v2 v on v.id = c.id
      where v.has_implementation <> (c.modules  is not null)
         or v.has_ams            <> (c.work_log is not null)
    `;

    // The dangerous cases: in a domain, but with nothing in it.
    const empty = await sql<{
      name: string;
      domain: string;
      rows: number;
    }[]>`
      select v.name, 'Implementation' as domain,
             (select count(*)::int from modules_v2 m
               where m.client_id = v.id and not m.archived) as rows
      from clients_v2 v
      where v.has_implementation
        and not exists (select 1 from modules_v2 m
                        where m.client_id = v.id and not m.archived)
      union all
      select v.name, 'AMS & Support',
             (select count(*)::int from ams_work_log_v2 w
               where w.client_id = v.id and not w.archived)
      from clients_v2 v
      where v.has_ams
        and not exists (select 1 from ams_work_log_v2 w
                        where w.client_id = v.id and not w.archived)
      order by 1
    `;

    console.log("  Clients in a domain with ZERO rows in it");
    console.log("  (these are the ones that vanish if the flag is lost)\n");
    printTable(
      empty.map((e) => ({ client: e.name, domain: e.domain, rows: e.rows })),
      ["client", "domain", "rows"],
    );

    console.log(`\n  Flag vs v1 sentinel mismatches: ${mismatches.length}`);
    for (const m of mismatches) console.log(`    ${m.name}: ${m.detail}`);

    if (mismatches.length) {
      console.log("\n  FAIL — domain flags disagree with v1.\n");
      process.exit(1);
    }
    console.log("\n  PASS — every flag matches the v1 sentinel exactly.\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("\n  failed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
