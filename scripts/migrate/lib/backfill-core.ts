import { IssueLog } from "./issues";
import { mapClient, type MappedClient } from "./mapping";
import { IdCollisionTracker } from "./ids";
import { insertBatch, type Executor } from "./executor";
import type { Client } from "@/lib/domain/types";

/**
 * The backfill itself: rebuild every v2 table from v1, inside one transaction.
 *
 * WHY REBUILD RATHER THAN RECONCILE
 *
 * The existing v2 rows are dual-write shadow output. That path is best-effort
 * (every call site swallows its errors), it mints `moduleId::phaseName` ids
 * that violate the app's own id rules, it bakes expired signed URLs into the
 * stored jsonb, it stamps updated_at with now() instead of preserving v1's
 * value, and it cannot represent domain membership at all. Reconciling against
 * that is strictly harder than discarding it — and nothing reads v2 yet, so
 * there is nothing to lose by discarding.
 *
 * TRUNCATE, not DELETE: the FKs are `on delete restrict`, so the six tables
 * must be emptied in a single statement. Soft-delete is an application rule
 * about user actions; a pre-cutover rebuild of an unread shadow schema is
 * deliberately exempt, and this is the only place in the codebase that is.
 *
 * The whole thing runs in ONE transaction. Either v2 is completely rebuilt or
 * it is untouched; there is no partially-migrated state to reason about.
 * v1 is never written to, which is what keeps rollback trivial.
 */

export const V2_TABLES = [
  "clients_v2",
  "integrations_v2",
  "milestones_v2",
  "modules_v2",
  "phases_v2",
  "ams_work_log_v2",
] as const;

const CLIENT_COLS = [
  "id", "name", "description", "man_day_rate", "total_available_hours",
  "currency", "master_assignee", "has_implementation", "has_ams",
  "created_at", "updated_at",
];
const INTEG_COLS = [
  "id", "client_id", "name", "status", "assignee", "due_date", "description",
  "next_action", "effort_weight", "activity_log", "created_at", "updated_at",
];
const MS_COLS = [
  "id", "integration_id", "client_id", "name", "status", "due_date", "owner",
  "notes", "created_at", "updated_at",
];
const MOD_COLS = ["id", "client_id", "name", "created_at", "updated_at"];
const PHASE_COLS = [
  "id", "module_id", "client_id", "phase_name", "status", "assignee",
  "start_date", "target_date", "current_activity", "next_action",
  "activity_log", "created_at", "updated_at",
];
const WL_COLS = [
  "id", "client_id", "date_raised", "due_date", "raised_by", "module",
  "project", "description", "entry_type", "query_level", "entry_status",
  "rag_status", "mode_of_support", "dependencies", "solution", "hours",
  "edit_history", "created_at", "updated_at",
];

export interface Tallies {
  clients: number;
  integrations: number;
  milestones: number;
  modules: number;
  phases: number;
  workLog: number;
}

export interface BackfillResult {
  tallies: Tallies;
  log: IssueLog;
  mapped: MappedClient[];
}

/** Maps every client and accumulates the rows, without touching the database. */
export function planBackfill(clients: Client[]): BackfillResult {
  const log = new IssueLog();
  const trackers = {
    integrations: new IdCollisionTracker("integrations_v2"),
    milestones: new IdCollisionTracker("milestones_v2"),
    modules: new IdCollisionTracker("modules_v2"),
    phases: new IdCollisionTracker("phases_v2"),
    workLog: new IdCollisionTracker("ams_work_log_v2"),
  };

  const mapped = clients.map((c) => mapClient(c, log, trackers));

  const tallies: Tallies = {
    clients: mapped.length,
    integrations: sum(mapped, (m) => m.integrations.length),
    milestones: sum(mapped, (m) => m.milestones.length),
    modules: sum(mapped, (m) => m.modules.length),
    phases: sum(mapped, (m) => m.phases.length),
    workLog: sum(mapped, (m) => m.workLog.length),
  };

  return { tallies, log, mapped };
}

/**
 * Writes the plan. Caller owns the transaction so the CLI and the tests can
 * both wrap this in BEGIN/COMMIT and roll back on any inconsistency.
 *
 * Insert order follows the FK graph: clients first, then the three subtrees
 * that reference only clients, then the two that reference those.
 */
export async function applyBackfill(
  exec: Executor,
  plan: BackfillResult,
): Promise<Tallies> {
  await exec.exec(`truncate table ${V2_TABLES.join(", ")}`);

  const all = plan.mapped;
  const written: Tallies = {
    clients: 0, integrations: 0, milestones: 0,
    modules: 0, phases: 0, workLog: 0,
  };

  written.clients = await insertBatch(
    exec, "clients_v2", CLIENT_COLS, all.map((m) => m.client),
  );
  written.integrations = await insertBatch(
    exec, "integrations_v2", INTEG_COLS, all.flatMap((m) => m.integrations),
  );
  written.modules = await insertBatch(
    exec, "modules_v2", MOD_COLS, all.flatMap((m) => m.modules),
  );
  written.workLog = await insertBatch(
    exec, "ams_work_log_v2", WL_COLS, all.flatMap((m) => m.workLog),
  );
  // These two reference the rows written above.
  written.milestones = await insertBatch(
    exec, "milestones_v2", MS_COLS, all.flatMap((m) => m.milestones),
  );
  written.phases = await insertBatch(
    exec, "phases_v2", PHASE_COLS, all.flatMap((m) => m.phases),
  );

  return written;
}

/**
 * Re-counts straight from the database and compares against what we intended
 * to write. Runs inside the transaction, so a mismatch can still roll back.
 * Catches a whole class of silent partial-write bugs that per-row error
 * handling would miss.
 */
export async function assertTallies(
  exec: Executor,
  expected: Tallies,
): Promise<{ ok: boolean; actual: Tallies; diff: string[] }> {
  const [row] = await exec.query<Record<string, string>>(`
    select
      (select count(*) from clients_v2)       as clients,
      (select count(*) from integrations_v2)  as integrations,
      (select count(*) from milestones_v2)    as milestones,
      (select count(*) from modules_v2)       as modules,
      (select count(*) from phases_v2)        as phases,
      (select count(*) from ams_work_log_v2)  as "workLog"
  `);

  const actual: Tallies = {
    clients: Number(row.clients),
    integrations: Number(row.integrations),
    milestones: Number(row.milestones),
    modules: Number(row.modules),
    phases: Number(row.phases),
    workLog: Number(row.workLog),
  };

  const diff: string[] = [];
  for (const key of Object.keys(expected) as (keyof Tallies)[]) {
    if (expected[key] !== actual[key]) {
      diff.push(`${key}: expected ${expected[key]}, found ${actual[key]}`);
    }
  }

  return { ok: diff.length === 0, actual, diff };
}

function sum<T>(items: T[], f: (t: T) => number): number {
  return items.reduce((a, t) => a + f(t), 0);
}
