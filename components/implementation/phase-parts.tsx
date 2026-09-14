"use client";

import { Lock, Check } from "lucide-react";
import { PHASES, SIGNOFF_PHASES } from "@/lib/domain/constants";
import { canCompletePhase } from "@/lib/domain/implementation";
import { fmtDate } from "@/lib/utils/dates";
import type { Phase } from "@/lib/domain/types";

/**
 * The two pieces of the phase screen that are worth showing somewhere else.
 *
 * They moved out of phase-view.tsx when the implementation matrix gained an
 * in-place detail mode: "Open phase" used to navigate away and lose the grid,
 * and the alternative to sharing these was a second copy of the sign-off rules
 * living in the panel — which is exactly how two screens come to disagree about
 * whether a phase is signed off.
 */

/**
 * The sign-off checklist (artboard 1f).
 *
 * THESE BOXES ARE INDICATORS, NOT CONTROLS. Every item is derived from data
 * that already exists, so there is nothing to store and nothing to click — they
 * are `aria-hidden` spans with the state carried in the text beside them. That
 * is deliberately the opposite of the milestone checkbox on the integration
 * screen, which really does write: a clickable box here would suggest you could
 * sign a phase off by ticking it, when the only thing that signs a phase off is
 * an attached document.
 */
export function Checklist({ phase }: { phase: Phase }) {
  const updates = phase.updates ?? [];
  const evidence = updates.find((u) => u.attachment?.storagePath);

  const items: { label: string; done: boolean; meta?: string }[] = [
    {
      label: "Owner assigned",
      done: Boolean(phase.assignee),
      meta: phase.assignee ?? "Nobody is named on this phase",
    },
    {
      label: "Target date set",
      done: Boolean(phase.targetDate),
      meta: phase.targetDate ? fmtDate(phase.targetDate) : "No date committed",
    },
    {
      label: "Progress logged",
      done: updates.length > 0,
      meta: updates.length
        ? `${updates.length} update${updates.length === 1 ? "" : "s"}`
        : "Nothing recorded yet",
    },
    {
      label: "Signed document attached",
      done: Boolean(evidence),
      meta: evidence
        ? `${evidence.attachment!.fileName} · ${fmtDate(evidence.date)}`
        : SIGNOFF_PHASES.includes(phase.name)
          ? "Required before this phase can be completed"
          : "Not required for this phase",
    },
    {
      label: "Phase completed",
      done: phase.status === "Completed",
      meta: phase.status,
    },
  ];

  return (
    <ul className="mt-3">
      {items.map((it) => (
        <li
          key={it.label}
          className="flex items-start gap-2.5 border-b border-k-line-2 py-2.5 last:border-b-0"
        >
          <span
            className="k-check mt-px"
            data-checked={it.done ? "true" : "false"}
            aria-hidden
          >
            {it.done && <Check size={11} strokeWidth={2.5} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-k-ink">
              {it.label}
              <span className="sr-only">
                {it.done ? " — done" : " — not done"}
              </span>
            </p>
            {it.meta && (
              <p className="mt-0.5 text-[10.5px] text-k-mute-2">{it.meta}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The gate, stated before anyone tries to complete the phase.
 *
 * BPU/CRP/UAT Signoff cannot be completed without a document attached to an
 * update. That rule lived only in js/events.js in the old app, which meant it
 * was advisory — any direct API call could complete a signoff phase with
 * nothing attached. It is enforced server-side now, and shown here from the
 * same domain function, so the screen and the server cannot disagree.
 *
 * It used to return null on the six ordinary phases, which left `canCompletePhase`'s
 * `warn` branch computed and rendered nowhere. Now every phase says what, if
 * anything, stands between it and the next one.
 */
export function SignoffNotice({ phase }: { phase: Phase }) {
  const gate = canCompletePhase({ ...phase, status: "Completed" } as Phase);
  const gated = !gate.ok;
  const isSignoff = SIGNOFF_PHASES.includes(phase.name);
  const next =
    PHASES[PHASES.indexOf(phase.name as (typeof PHASES)[number]) + 1];

  const body = gated
    ? `${gate.reason}${next ? ` ${next} stays blocked until it is.` : ""}`
    : isSignoff
      ? "Signed document attached — this phase can be completed."
      : phase.status === "Completed"
        ? "This phase is complete. Nothing gates the next one."
        : (gate.warn ??
          (next ? `Nothing gates ${next} but this phase finishing.` : ""));

  if (!body) return null;

  return (
    <div
      className="k-callout mt-4 flex items-start gap-2.5"
      style={
        !gated && (isSignoff || phase.status === "Completed")
          ? { background: "var(--k-tint-green)", borderColor: "transparent" }
          : undefined
      }
    >
      {gated ? (
        <Lock
          size={15}
          strokeWidth={1.5}
          className="mt-px shrink-0 text-k-text-amber"
        />
      ) : (
        <Check
          size={15}
          strokeWidth={1.5}
          className="mt-px shrink-0 text-k-text-green"
        />
      )}
      <p className="text-[12px] text-k-ink-3">{body}</p>
    </div>
  );
}

