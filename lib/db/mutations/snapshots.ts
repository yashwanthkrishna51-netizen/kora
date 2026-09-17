import { sql } from "drizzle-orm";
import { portfolioSnapshots } from "@/lib/db/schema";
import { getClientTrees } from "@/lib/db/queries/clients";
import { integRagLabel, integStatusSegments, overallRagLabel } from "@/lib/domain/integrations";
import { implAutoRag, implProgress } from "@/lib/domain/implementation";
import { amsClientRag, amsOpenCounts, amsTotals } from "@/lib/domain/ams";
import { todayStr } from "@/lib/utils/dates";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * The daily portfolio snapshot — one row per client, feeding the dashboard's
 * trend arrows.
 *
 * COMPUTED HERE, NOT SENT BY THE BROWSER. The old endpoint accepted a `rows`
 * array of already-calculated figures and wrote them as given
 * (api/snapshot.js:53-77). It blocked viewers, but any editor could post
 * fabricated numbers straight into the data leadership reads as a trend — and
 * because a snapshot is only ever compared against other snapshots, a wrong
 * one is invisible forever after.
 *
 * Deriving them server-side removes the question entirely, and costs nothing:
 * every figure comes from the same golden-master-tested domain functions the
 * screens use, so the snapshot cannot disagree with what the dashboard shows.
 */

/**
 * The date is the SERVER's, never the caller's.
 *
 * `snapshot_date` is half the primary key. A client with a skewed clock — or
 * one simply in another timezone — could otherwise overwrite yesterday's row
 * or create tomorrow's, and the trend would quietly reshape itself.
 */
export async function captureSnapshot(
  db: AnyDb,
  now: Date = new Date(),
): Promise<{ date: string; clients: number }> {
  const date = todayStr(now);
  const clients = await getClientTrees(db);

  // The billing window the AMS hours figure covers: this calendar month to
  // date, matching what the AMS screen shows for "hours this period".
  const monthStart = `${date.slice(0, 7)}-01`;

  const rows = clients.map((c) => {
    const segments = integStatusSegments(c, now);
    const integR = integRagLabel(c, now);
    const implR = c.modules !== undefined ? implAutoRag(c, now) : null;
    const amsR = c.workLog !== undefined ? amsClientRag(c, now) : null;
    const progress = implProgress(c);
    const open = amsOpenCounts(c);
    const totals = amsTotals(c, monthStart, date);

    return {
      snapshotDate: date,
      clientId: c.id,
      clientName: c.name,
      integTotal: segments.total,
      integAtRisk: segments.risk,
      integInProgress: segments.wip,
      integCompleted: segments.done,
      implRag: implR,
      implTotalPhases: progress.total,
      implCompletedPhases: progress.completed,
      amsRag: amsR,
      amsOpenEntries: open.open,
      amsOpenL3l4: open.openL3L4,
      amsHoursMonth: String(totals.totalHours ?? 0),
      overallRag: overallRagLabel(integR, implR, amsR),
    };
  });

  if (!rows.length) return { date, clients: 0 };

  // Upsert on (date, client): capturing twice in a day refreshes rather than
  // failing, which is what makes it safe to trigger from a page load.
  await db
    .insert(portfolioSnapshots)
    .values(rows)
    .onConflictDoUpdate({
      target: [portfolioSnapshots.snapshotDate, portfolioSnapshots.clientId],
      set: {
        clientName: sql`excluded.client_name`,
        integTotal: sql`excluded.integ_total`,
        integAtRisk: sql`excluded.integ_at_risk`,
        integInProgress: sql`excluded.integ_in_progress`,
        integCompleted: sql`excluded.integ_completed`,
        implRag: sql`excluded.impl_rag`,
        implTotalPhases: sql`excluded.impl_total_phases`,
        implCompletedPhases: sql`excluded.impl_completed_phases`,
        amsRag: sql`excluded.ams_rag`,
        amsOpenEntries: sql`excluded.ams_open_entries`,
        amsOpenL3l4: sql`excluded.ams_open_l3l4`,
        amsHoursMonth: sql`excluded.ams_hours_month`,
        overallRag: sql`excluded.overall_rag`,
      },
    });

  return { date, clients: rows.length };
}
