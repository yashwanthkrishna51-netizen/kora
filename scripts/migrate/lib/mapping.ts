import { PHASES } from "@/lib/domain/constants";
import type { Client } from "@/lib/domain/types";
import { IssueLog, loc } from "./issues";
import {
  coerceDate,
  coerceNullableNumber,
  coerceNumber,
  coerceRequiredText,
  coerceText,
  coerceTimestamp,
} from "./coerce";
import {
  derivePhaseId,
  deriveEntryId,
  resolveId,
  type IdCollisionTracker,
} from "./ids";
import { normalizeActivityLog } from "./attachments";

/**
 * THE mapping from a v1 client row to its v2 rows.
 *
 * This is a pure function, and it is the single source of truth for the
 * migration: backfill inserts what it returns, and verify re-derives from it
 * and diffs against what is actually in the database. Because both sides run
 * the same code, a mapping bug shows up as a v1-vs-v2 difference rather than
 * cancelling itself out — which is why verify also runs an independent inverse
 * pass (lib/inverse.ts) that does NOT share this code.
 *
 * It mirrors api/_dualwrite.js, with these deliberate divergences:
 *
 *   - domain membership is emitted as explicit booleans (v1's null-sentinel)
 *   - phase ids are re-minted, never `moduleId::phaseName`
 *   - values are coerced with recorded issues instead of `|| null`
 *   - `date_raised` gets a fallback chain rather than being passed through
 *     into a NOT NULL column
 *   - attachments are normalized to storagePath and the dead signed URL dropped
 *   - timestamps are preserved from v1 rather than set to now()
 */

const PHASE_SET: ReadonlySet<string> = new Set(PHASES);

export interface ClientRow {
  id: string;
  name: string;
  description: string | null;
  man_day_rate: number | null;
  total_available_hours: number | null;
  currency: string;
  master_assignee: string | null;
  has_implementation: boolean;
  has_ams: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface IntegrationRow {
  id: string;
  client_id: string;
  name: string;
  status: string;
  assignee: string | null;
  due_date: string | null;
  description: string | null;
  next_action: string | null;
  effort_weight: number;
  activity_log: unknown[];
  created_at: string | null;
  updated_at: string | null;
}

export interface MilestoneRow {
  id: string;
  integration_id: string;
  client_id: string;
  name: string;
  status: string;
  due_date: string | null;
  owner: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ModuleRow {
  id: string;
  client_id: string;
  name: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface PhaseRow {
  id: string;
  module_id: string;
  client_id: string;
  phase_name: string;
  status: string;
  assignee: string | null;
  start_date: string | null;
  target_date: string | null;
  current_activity: string | null;
  next_action: string | null;
  activity_log: unknown[];
  created_at: string | null;
  updated_at: string | null;
}

export interface WorkLogRow {
  id: string;
  client_id: string;
  date_raised: string;
  due_date: string | null;
  raised_by: string | null;
  module: string | null;
  project: string | null;
  description: string | null;
  entry_type: string | null;
  query_level: string | null;
  entry_status: string;
  rag_status: string | null;
  mode_of_support: string | null;
  dependencies: string | null;
  solution: string | null;
  hours: number;
  edit_history: unknown[];
  created_at: string | null;
  updated_at: string | null;
}

export interface MappedClient {
  client: ClientRow;
  integrations: IntegrationRow[];
  milestones: MilestoneRow[];
  modules: ModuleRow[];
  phases: PhaseRow[];
  workLog: WorkLogRow[];
}

export interface Trackers {
  integrations?: IdCollisionTracker;
  milestones?: IdCollisionTracker;
  modules?: IdCollisionTracker;
  phases?: IdCollisionTracker;
  workLog?: IdCollisionTracker;
}

/** Date part of a timestamp, for the date_raised fallback chain. */
function datePartOf(ts: string | null): string | null {
  if (!ts) return null;
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function mapClient(
  v1: Client & {
    createdAt?: string | null;
    updatedAt?: string | null;
    _v?: string;
  },
  log: IssueLog,
  trackers: Trackers = {},
): MappedClient {
  const cid = v1.id;

  const clientCreated = coerceTimestamp(v1.createdAt ?? null);
  // `_v` is the OCC token, which IS updated_at — accept either spelling.
  const clientUpdated =
    coerceTimestamp(v1.updatedAt ?? null) ?? coerceTimestamp(v1._v ?? null);

  // --- membership ---------------------------------------------------------
  // The whole reason migration 0003 exists. `modules` present (even as [])
  // means the client is in the Implementation domain.
  const hasImplementation = v1.modules !== undefined && v1.modules !== null;
  const hasAms = v1.workLog !== undefined && v1.workLog !== null;
  if (hasImplementation || hasAms) {
    log.add("MEMBERSHIP_DERIVED", loc(cid), undefined,
      `impl=${hasImplementation} ams=${hasAms}`);
  }

  const client: ClientRow = {
    id: cid,
    name: coerceRequiredText(v1.name, log, loc(cid, undefined, undefined, "name")),
    description: coerceText(v1.description, ""),
    man_day_rate: coerceNullableNumber(
      v1.manDayRate,
      log,
      loc(cid, undefined, undefined, "manDayRate"),
    ),
    total_available_hours: coerceNullableNumber(
      v1.totalAvailableHours,
      log,
      loc(cid, undefined, undefined, "totalAvailableHours"),
    ),
    currency: v1.currency || "INR",
    master_assignee: coerceText(v1.masterAssignee),
    has_implementation: hasImplementation,
    has_ams: hasAms,
    created_at: clientCreated,
    updated_at: clientUpdated,
  };

  // --- integrations + milestones ------------------------------------------
  const integrations: IntegrationRow[] = [];
  const milestones: MilestoneRow[] = [];

  (v1.integrations ?? []).forEach((i, idx) => {
    const at = loc(cid, "integrations", idx);
    const id = resolveId(
      i.id,
      () => deriveEntryId("in", cid, "integrations", idx, i.name ?? ""),
      log,
      at,
    );
    trackers.integrations?.check(id, at, log);

    integrations.push({
      id,
      client_id: cid,
      name: coerceRequiredText(i.name, log, `${at}.name`),
      status: i.status || "Not Started",
      assignee: coerceText(i.assignee),
      due_date: coerceDate(i.dueDate, log, `${at}.dueDate`),
      description: coerceText(i.description, ""),
      next_action: coerceText(i.nextAction, ""),
      effort_weight: coerceNumber(i.effortWeight, 0.5, log, `${at}.effortWeight`, {
        min: 0,
        max: 10,
      }),
      activity_log: normalizeActivityLog(i.timeline, log, `${at}.timeline`),
      created_at: coerceTimestamp(i.createdAt ?? null) ?? clientCreated,
      updated_at: clientUpdated,
    });

    (i.milestones ?? []).forEach((ms, mIdx) => {
      const mAt = loc(cid, `integrations[${idx}].milestones`, mIdx);
      const msId = resolveId(
        ms.id,
        () =>
          deriveEntryId(
            "ms",
            cid,
            `integrations[${idx}].milestones`,
            mIdx,
            ms.name ?? "",
          ),
        log,
        mAt,
      );
      trackers.milestones?.check(msId, mAt, log);

      milestones.push({
        id: msId,
        integration_id: id,
        client_id: cid,
        name: coerceRequiredText(ms.name, log, `${mAt}.name`),
        status: ms.status || "Pending",
        due_date: coerceDate(ms.dueDate, log, `${mAt}.dueDate`),
        owner: coerceText(ms.owner),
        notes: coerceText(ms.notes, ""),
        // v1 milestones carry no timestamps of their own.
        created_at: clientCreated,
        updated_at: clientUpdated,
      });
    });
  });

  // --- modules + phases ----------------------------------------------------
  const modules: ModuleRow[] = [];
  const phases: PhaseRow[] = [];

  (v1.modules ?? []).forEach((m, idx) => {
    const at = loc(cid, "modules", idx);
    const mid = resolveId(
      m.id,
      () => deriveEntryId("md", cid, "modules", idx, m.name ?? ""),
      log,
      at,
    );
    trackers.modules?.check(mid, at, log);

    modules.push({
      id: mid,
      client_id: cid,
      name: coerceRequiredText(m.name, log, `${at}.name`),
      created_at: clientCreated,
      updated_at: clientUpdated,
    });

    // uq_phases_v2_module_phasename_active means one active row per
    // (module, phase name) — catch duplicates before the insert does.
    const seenPhaseNames = new Set<string>();

    (m.phases ?? []).forEach((ph, pIdx) => {
      const pAt = loc(cid, `modules[${idx}].phases`, pIdx);
      const phaseName = coerceRequiredText(ph.name, log, `${pAt}.name`);

      if (phaseName && !PHASE_SET.has(phaseName)) {
        log.add("PHASE_NAME_UNKNOWN", `${pAt}.name`, phaseName);
      }
      if (phaseName) {
        if (seenPhaseNames.has(phaseName)) {
          log.add("PHASE_NAME_DUP", `${pAt}.name`, phaseName,
            `module ${mid} already has this phase`);
        }
        seenPhaseNames.add(phaseName);
      }

      const pid = resolveId(ph.id, () => derivePhaseId(mid, phaseName), log, pAt);
      trackers.phases?.check(pid, pAt, log);

      phases.push({
        id: pid,
        module_id: mid,
        client_id: cid,
        phase_name: phaseName,
        status: ph.status || "Not Started",
        assignee: coerceText(ph.assignee),
        start_date: coerceDate(ph.startDate, log, `${pAt}.startDate`),
        target_date: coerceDate(ph.targetDate, log, `${pAt}.targetDate`),
        current_activity: coerceText(ph.currentActivity, ""),
        next_action: coerceText(ph.nextAction, ""),
        activity_log: normalizeActivityLog(ph.updates, log, `${pAt}.updates`),
        created_at: clientCreated,
        updated_at: clientUpdated,
      });
    });
  });

  // --- AMS work log --------------------------------------------------------
  const workLog: WorkLogRow[] = [];

  (v1.workLog ?? []).forEach((e, idx) => {
    const at = loc(cid, "workLog", idx);
    const id = resolveId(
      e.id,
      () => deriveEntryId("wl", cid, "workLog", idx, e.description ?? ""),
      log,
      at,
    );
    trackers.workLog?.check(id, at, log);

    const loggedAt = coerceTimestamp(e.loggedAt ?? null);

    // date_raised is NOT NULL in v2. The old dual-write passed e.dateRaised
    // straight through, so entries missing it have been failing the shadow
    // write silently all along. Fall back rather than lose the record.
    let dateRaised = coerceDate(e.dateRaised ?? e.date, log, `${at}.dateRaised`);
    if (!dateRaised) {
      dateRaised = datePartOf(loggedAt);
      if (dateRaised) {
        log.add("DATERAISED_FALLBACK", `${at}.dateRaised`, undefined,
          `fell back to loggedAt -> ${dateRaised}`);
      }
    }
    if (!dateRaised) {
      dateRaised = datePartOf(clientCreated);
      if (dateRaised) {
        log.add("DATERAISED_FALLBACK", `${at}.dateRaised`, undefined,
          `fell back to client created_at -> ${dateRaised}`);
      }
    }
    if (!dateRaised) {
      // Only reachable if the client row itself has no created_at.
      dateRaised = "1970-01-01";
      log.add("DATERAISED_FALLBACK", `${at}.dateRaised`, undefined,
        "no date available anywhere; used epoch");
    }

    workLog.push({
      id,
      client_id: cid,
      date_raised: dateRaised,
      due_date: coerceDate(e.dueDate, log, `${at}.dueDate`),
      raised_by: coerceText(e.raisedBy ?? e.loggedBy),
      module: coerceText(e.module),
      project: coerceText(e.project),
      description: coerceText(e.description, ""),
      entry_type: coerceText(e.type ?? e.category),
      query_level: coerceText(e.queryLevel),
      entry_status: e.entryStatus || "Open",
      rag_status: coerceText(e.ragStatus),
      mode_of_support: coerceText(e.modeOfSupport),
      dependencies: coerceText(e.dependencies, ""),
      solution: coerceText(e.solution, ""),
      hours: coerceNumber(e.hours, 0, log, `${at}.hours`, { min: 0, max: 1000 }),
      edit_history: normalizeActivityLog(e.edits, log, `${at}.edits`),
      created_at: loggedAt ?? clientCreated,
      updated_at: clientUpdated,
    });
  });

  return { client, integrations, milestones, modules, phases, workLog };
}
