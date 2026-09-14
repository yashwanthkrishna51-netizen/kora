import type { Client } from "@/lib/domain/types";
import type { MappedClient } from "@/scripts/migrate/lib/mapping";

/**
 * v2 rows -> the v1-shaped client object.
 *
 * This is verify.ts's second, independent leg. The forward check re-derives v2
 * from v1 using the same mapping code the backfill used, so a bug in that code
 * cancels itself out and the diff looks clean. Going backwards through
 * different code cannot cancel out that way: if the mapping dropped a field,
 * the reconstruction can't invent it.
 *
 * It also doubles as the emergency v2 -> v1 export used in the post-cutover
 * rollback path, which means the export is exercised on every verify run
 * instead of being written once and hoped about.
 *
 * Sentinel reconstruction mirrors api/read.js:45-62 exactly: the `modules` and
 * `workLog` keys are only attached when the client is in that domain, because
 * their presence — not their contents — is what the old app tested.
 */

export interface V2Snapshot {
  client: Record<string, unknown>;
  integrations: Record<string, unknown>[];
  milestones: Record<string, unknown>[];
  modules: Record<string, unknown>[];
  phases: Record<string, unknown>[];
  workLog: Record<string, unknown>[];
}

/**
 * Two callers feed this function rows from two different drivers.
 *
 * `verify.ts` reads with raw SQL, so its keys are the database's own
 * snake_case. The API reads through Drizzle, which maps them to the camelCase
 * property names declared in schema.ts. Feeding camelCase rows to a body that
 * reads `has_implementation` does not throw — every lookup just returns
 * undefined, so the client comes back structurally valid but stripped of its
 * modules, work log and dates. That failure is silent and survives a casual
 * eyeball, which is exactly why the keys are normalized here instead of the
 * body being taught to accept either spelling.
 *
 * SHALLOW on purpose. jsonb payloads (activity_log entries, edit history) carry
 * camelCase keys that are part of the stored data — `addedBy`, `storagePath` —
 * and rewriting those would corrupt the very values being reconstructed.
 */
function snakeKeys(row: Record<string, unknown>): Record<string, unknown> {
  let needsWork = false;
  for (const k in row) {
    if (/[A-Z]/.test(k)) {
      needsWork = true;
      break;
    }
  }
  if (!needsWork) return row; // already snake_case — the verify.ts path

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  }
  return out;
}

/** Comparable v1 shape. Field order is normalized so JSON compare is stable. */
export function toV1Shape(input: V2Snapshot): Client {
  const snap: V2Snapshot = {
    client: snakeKeys(input.client),
    integrations: input.integrations.map(snakeKeys),
    milestones: input.milestones.map(snakeKeys),
    modules: input.modules.map(snakeKeys),
    phases: input.phases.map(snakeKeys),
    workLog: input.workLog.map(snakeKeys),
  };
  const c = snap.client;

  const out: Client = {
    id: String(c.id),
    name: str(c.name) ?? "",
    description: str(c.description) ?? "",
    currency: (str(c.currency) as Client["currency"]) ?? "INR",
    integrations: snap.integrations
      .filter((i) => !i.archived)
      .sort(byId)
      .map((i) => ({
        id: String(i.id),
        name: str(i.name) ?? "",
        status: str(i.status) as never,
        assignee: str(i.assignee) ?? undefined,
        dueDate: dateStr(i.due_date) ?? undefined,
        description: str(i.description) ?? "",
        nextAction: str(i.next_action) ?? "",
        effortWeight: num(i.effort_weight),
        timeline: asArray(i.activity_log),
        milestones: snap.milestones
          .filter((m) => !m.archived && m.integration_id === i.id)
          .sort(byId)
          .map((m) => ({
            id: String(m.id),
            name: str(m.name) ?? "",
            status: str(m.status) as never,
            dueDate: dateStr(m.due_date) ?? undefined,
            owner: str(m.owner) ?? undefined,
            notes: str(m.notes) ?? "",
          })),
      })),
  };

  if (c.master_assignee != null) out.masterAssignee = String(c.master_assignee);
  if (c.man_day_rate != null) out.manDayRate = num(c.man_day_rate);
  if (c.total_available_hours != null) {
    out.totalAvailableHours = num(c.total_available_hours);
  }

  // The sentinel. Attach the key only when the flag says the client is in the
  // domain — this is the whole reason migration 0003 exists.
  if (c.has_implementation) {
    out.modules = snap.modules
      .filter((m) => !m.archived)
      .sort(byId)
      .map((m) => ({
        id: String(m.id),
        name: str(m.name) ?? "",
        phases: snap.phases
          .filter((p) => !p.archived && p.module_id === m.id)
          .sort(byId)
          .map((p) => ({
            id: String(p.id),
            name: str(p.phase_name) ?? "",
            status: str(p.status) as never,
            assignee: str(p.assignee) ?? undefined,
            startDate: dateStr(p.start_date) ?? undefined,
            targetDate: dateStr(p.target_date) ?? undefined,
            currentActivity: str(p.current_activity) ?? "",
            nextAction: str(p.next_action) ?? "",
            updates: asArray(p.activity_log),
          })),
      }));
  }

  if (c.has_ams) {
    out.workLog = snap.workLog
      .filter((w) => !w.archived)
      .sort(byId)
      .map((w) => ({
        id: String(w.id),
        dateRaised: dateStr(w.date_raised) ?? undefined,
        dueDate: dateStr(w.due_date) ?? undefined,
        raisedBy: str(w.raised_by) ?? undefined,
        module: str(w.module) ?? undefined,
        project: str(w.project) ?? undefined,
        description: str(w.description) ?? "",
        type: str(w.entry_type) ?? undefined,
        queryLevel: str(w.query_level) ?? undefined,
        entryStatus: str(w.entry_status) as never,
        ragStatus: str(w.rag_status) as never,
        modeOfSupport: str(w.mode_of_support) ?? undefined,
        dependencies: str(w.dependencies) ?? "",
        solution: str(w.solution) ?? "",
        hours: num(w.hours),
        edits: asArray(w.edit_history) as never,
      }));
  }

  return out;
}

/** Same shape, straight from a MappedClient — used to compare plan vs. reality. */
export function mappedToV1Shape(m: MappedClient): Client {
  return toV1Shape({
    client: m.client as unknown as Record<string, unknown>,
    integrations: m.integrations as unknown as Record<string, unknown>[],
    milestones: m.milestones as unknown as Record<string, unknown>[],
    modules: m.modules as unknown as Record<string, unknown>[],
    phases: m.phases as unknown as Record<string, unknown>[],
    workLog: m.workLog as unknown as Record<string, unknown>[],
  });
}

function byId(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return String(a.id).localeCompare(String(b.id));
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v);
}

/**
 * Normalizes a `date` column to `YYYY-MM-DD`.
 *
 * Drivers disagree about this: postgres.js hands back a string, PGlite hands
 * back a JS Date. Stringifying a Date naively yields
 * "Tue Aug 04 2026 05:30:00 GMT+0530", which silently corrupts every date in
 * the comparison — so dates go through here rather than through str().
 *
 * Uses the UTC components: Postgres `date` has no time or zone, and the driver
 * materializes it at UTC midnight, so local formatting would shift the day
 * backwards for anyone east of Greenwich.
 */
function dateStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  // Already a date, or a timestamp we only want the date part of.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  return typeof v === "number" ? v : Number(v);
}

function asArray(v: unknown): never[] {
  if (Array.isArray(v)) return v as never[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as never[]) : ([] as never[]);
    } catch {
      return [] as never[];
    }
  }
  return [] as never[];
}
