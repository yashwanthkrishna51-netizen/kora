import { daysDiff } from "@/lib/utils/dates";
import { SIGNOFF_PHASES, PHASES, type PhaseName } from "./constants";
import type { Client, Module, Phase, Rag } from "./types";

/** Implementation progress + health, ported from js/implementation.js:2-6 and :288-310. */

export function implProgress(client: Client) {
  let total = 0;
  let completed = 0;
  let atRisk = 0;
  for (const m of client.modules ?? []) {
    for (const ph of m.phases ?? []) {
      total++;
      if (ph.status === "Completed") completed++;
      if (ph.status === "At Risk") atRisk++;
    }
  }
  return {
    total,
    completed,
    atRisk,
    pct: total ? Math.round((completed / total) * 100) : 0,
  };
}

/**
 * Per-client Implementation RAG.
 *
 * Only phases that are neither Completed nor Not Started count as "in progress".
 * For each of those, worst signal wins:
 *   - status At Risk                        -> Red
 *   - target date slipped by >= 14 days     -> Red
 *   - target date slipped by >= 1 day       -> Amber
 *   - no updates at all                     -> Amber
 *   - last update >= 14 days ago            -> Red
 *   - last update >= 7 days ago             -> Amber
 *
 * A client whose phases are all Completed/Not Started is Green (provided it has
 * modules); a client with no modules at all returns null ("not tracked").
 *
 * Ported verbatim, including that the date-slip check short-circuits the
 * staleness check for the same phase.
 */
export function implAutoRag(client: Client, now: Date = new Date()): Rag | null {
  let hasRed = false;
  let hasAmber = false;
  let hasInProgress = false;

  for (const m of client.modules ?? []) {
    for (const ph of m.phases ?? []) {
      if (ph.status === "Completed" || ph.status === "Not Started") continue;
      hasInProgress = true;

      if (ph.status === "At Risk") {
        hasRed = true;
        continue;
      }

      if (ph.targetDate) {
        const d = daysDiff(ph.targetDate, now);
        if (d !== null && d >= 14) {
          hasRed = true;
          continue;
        }
        if (d !== null && d >= 1) {
          hasAmber = true;
          continue;
        }
      }

      const updates = ph.updates ?? [];
      if (!updates.length) {
        hasAmber = true;
        continue;
      }

      // Newest timestamp wins; entries may carry addedAt or fall back to date.
      const lastUpd = updates.reduce((acc, u) => {
        const dt = u.addedAt || u.date || "";
        return dt > acc ? dt : acc;
      }, "");
      const daysAgo = lastUpd
        ? Math.floor((now.getTime() - new Date(lastUpd).getTime()) / 86400000)
        : 99;

      if (daysAgo >= 14) hasRed = true;
      else if (daysAgo >= 7) hasAmber = true;
    }
  }

  if (!hasInProgress && (client.modules ?? []).length > 0) return "Green";
  if (hasRed) return "Red";
  if (hasAmber) return "Amber";
  if (!hasInProgress) return null;
  return "Green";
}

export function isSignoffPhase(phaseName: string): boolean {
  return SIGNOFF_PHASES.includes(phaseName);
}

/**
 * The nine phases, indexed by name.
 *
 * EVERY helper below goes through this rather than reading `m.phases[i]`. A
 * module can be missing a row — the grid renders that as an empty cell — and
 * positional indexing would silently shift every later phase up one, turning
 * "CRP is at risk" into "BPU Signoff is at risk". Both existing screens already
 * take this precaution (matrix-view builds the same map, phase-view drives its
 * track from PHASES); putting it here means the new helpers cannot forget.
 */
function phasesByName(m: Module): Map<string, Phase> {
  return new Map((m.phases ?? []).map((p) => [p.name, p] as const));
}

/**
 * The module's live edge: the first phase, in delivery order, that is not
 * Completed. Null once every phase it holds is done.
 */
export function currentPhase(m: Module): Phase | null {
  const byName = phasesByName(m);
  for (const name of PHASES) {
    const p = byName.get(name);
    if (p && p.status !== "Completed") return p;
  }
  return null;
}

/**
 * Who is on this module now — artboard 1e's sub-line under the module name.
 *
 * `Module` HAS NO OWNER COLUMN. This is the current phase's assignee, which is
 * the honest answer to "who is working on this", and the UI labels it that way
 * rather than as a permanent owner. Falling back to the last assigned phase
 * covers a finished module and an unassigned live phase, both of which would
 * otherwise read as nobody ever having touched it.
 */
export function moduleOwner(m: Module): string | null {
  const cur = currentPhase(m);
  if (cur?.assignee) return cur.assignee;

  const byName = phasesByName(m);
  for (let i = PHASES.length - 1; i >= 0; i--) {
    const a = byName.get(PHASES[i])?.assignee;
    if (a) return a;
  }
  return null;
}

/**
 * Signed off = Completed AND the sign-off gate is satisfied.
 *
 * NOT `status === "Completed"`. A sign-off phase marked Completed without an
 * attachment cannot exist through the API — `lib/db/mutations/tracker.ts`
 * rejects it with the identical `canCompletePhase` call — but it can exist in
 * data migrated from v1, which had no such rule. Delegating here means the
 * matrix cell, the panel row and the server all answer the question the same
 * way, and the one that disagrees with the data shows the truth.
 */
export function phaseSignedOff(p: Phase): boolean {
  return p.status === "Completed" && canCompletePhase(p).ok;
}

/** The numbers behind artboard 1e's first two stat cards. */
export function implSignoffCounts(c: Client): {
  signedOff: number;
  total: number;
  atRiskOrDelayed: number;
} {
  let total = 0;
  let signedOff = 0;
  let atRiskOrDelayed = 0;

  for (const m of c.modules ?? []) {
    for (const p of m.phases ?? []) {
      total++;
      if (phaseSignedOff(p)) signedOff++;
      if (p.status === "At Risk" || p.status === "Delayed") atRiskOrDelayed++;
    }
  }
  return { signedOff, total, atRiskOrDelayed };
}

/** `satisfies` so a rename of the phase constant breaks the build, not the card. */
const GO_LIVE = "Go Live" satisfies PhaseName;

/**
 * Projected go-live — artboard 1e's third stat card.
 *
 * The LATEST Go Live target across the client's modules, because the client is
 * live when the last module is, not the first. There is no go-live column; this
 * is derived, and reads as "—" when no Go Live phase carries a target date.
 * ISO dates compare lexicographically, so no parsing is needed.
 */
export function projectedGoLive(c: Client): string | null {
  let latest: string | null = null;
  for (const m of c.modules ?? []) {
    for (const p of m.phases ?? []) {
      if (p.name !== GO_LIVE || !p.targetDate) continue;
      if (!latest || p.targetDate > latest) latest = p.targetDate;
    }
  }
  return latest;
}

/**
 * Sign-off gate, ported from js/events.js:296-303.
 *
 * A sign-off phase cannot be marked Completed unless at least one of its
 * updates carries an attachment — that attachment IS the sign-off evidence.
 * Non-sign-off phases completing without any attachment get a soft advisory
 * (`warn`), not a block.
 */
export function canCompletePhase(
  phase: Phase,
): { ok: true; warn?: string } | { ok: false; reason: string } {
  const updates = phase.updates ?? [];
  const hasAttachment = updates.some((u) => u.attachment?.storagePath);

  if (isSignoffPhase(phase.name) && !hasAttachment) {
    return {
      ok: false,
      reason: `${phase.name} needs a signed-off document attached to an update before it can be completed.`,
    };
  }

  if (!hasAttachment) {
    return {
      ok: true,
      warn: "Completing without an attachment — consider attaching evidence.",
    };
  }

  return { ok: true };
}

/**
 * Counts of ACTIVELY WORKED phases per phase name — the phase-funnel tile.
 *
 * "Actively worked" is exactly `In Progress` or `At Risk`, matching
 * js/dashboard.js:149. This was originally ported as "anything that is not
 * Completed or Not Started", which silently also counted both On Holds,
 * Pending Client, Under Review, Delayed and Cancelled — six statuses that
 * describe work which is explicitly NOT progressing, in a tile whose whole
 * point is to show where work is piling up. Every bar was inflated.
 *
 * The mistake survived because the golden suite can only diff functions that
 * exist as named functions in the old source, and this logic is inline inside
 * `dashboard.js`'s render. tests/golden/dashboard.test.ts closes that gap with
 * a transcribed reference implementation.
 *
 * All nine phases are present in the result, including zeroes, because the
 * funnel renders a fixed set of rows and a missing key is not the same as a
 * count of zero.
 */
export function phaseFunnel(clients: Client[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of PHASES) out[name] = 0;

  for (const c of clients) {
    for (const m of c.modules ?? []) {
      for (const ph of m.phases ?? []) {
        if (ph.status !== "In Progress" && ph.status !== "At Risk") continue;
        out[ph.name] = (out[ph.name] ?? 0) + 1;
      }
    }
  }
  return out;
}
