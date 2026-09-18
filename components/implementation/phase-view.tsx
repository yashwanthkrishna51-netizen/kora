"use client";

import { useRef, type RefObject } from "react";
import Link from "next/link";
import { ChevronLeft, Check } from "lucide-react";
import { toast } from "sonner";
import { useClient } from "@/lib/query/hooks";
import { QueryState, EmptyState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status";
import { InlineSelect, InlineText } from "@/components/ui/inline";
import { useCanEdit, useAssigneeOptions } from "@/lib/query/permissions";
import { useUpdateEntity } from "@/lib/query/mutations";
import { ActivityFeed } from "@/components/activity-feed";
import { SplitPane } from "@/components/ui/resizable";
import { Checklist, SignoffNotice } from "@/components/implementation/phase-parts";
import { PHASES, STATUSES, shortPhase } from "@/lib/domain/constants";
import { canCompletePhase, phaseSignedOff } from "@/lib/domain/implementation";
import { fmtDate } from "@/lib/utils/dates";
import type { Phase } from "@/lib/domain/types";

/**
 * Phase detail (artboard 1f): `1fr 250px`, with the nine-step track across the
 * top.
 *
 * THE TRACK SHOWS WHERE THIS PHASE SITS IN THE FIXED SEQUENCE, which is the
 * question the old app's phase page could not answer — it showed one phase in
 * isolation, so "is CRP Signoff before or after UAT" meant going back to the
 * matrix. The nine names are a constant, not derived from the data, so the
 * track is identical on every phase of every module.
 */
export function PhaseDetailView({
  clientId,
  moduleId,
  phaseName,
}: {
  clientId: string;
  moduleId: string;
  phaseName: string;
}) {
  const query = useClient(clientId);
  const client = query.data;
  const mod = client?.modules?.find((m) => m.id === moduleId);
  const phase = mod?.phases?.find((p) => p.name === phaseName);
  const canEdit = useCanEdit();
  const assignees = useAssigneeOptions(phase?.assignee);
  // 1f's Actions card does not open anything new — "Log an update" and
  // "Reassign" send you to the controls already on this page. Refs rather than
  // ids so two phase pages could never collide.
  const updatesRef = useRef<HTMLDivElement>(null);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const target = phase
    ? {
        kind: "phase" as const,
        clientId,
        id: phase.id,
        path: `/api/phases/${encodeURIComponent(phase.id)}`,
        screen: "implementation",
      }
    : undefined;

  return (
    <div className="k-page">
      <QueryState
        isPending={query.isPending}
        isPaused={query.isPaused}
        error={query.error}
        onRetry={() => query.refetch()}
        skeletonRows={7}
      >
        {!mod ? (
          <EmptyState
            title="That module is no longer here"
            hint="It may have been archived."
          />
        ) : (
          <>
            <Link
              href={`/implementation/${clientId}`}
              className="mb-3 inline-flex items-center gap-1 text-[12px] text-k-mute hover:text-k-primary"
            >
              <ChevronLeft size={13} strokeWidth={1.5} aria-hidden />
              {client?.name ?? "Back"} · {mod.name}
            </Link>

            {/* 1f puts the title, the meta line and the whole nine-step track
                inside one card, so the sequence reads as part of the header
                rather than as a stray strip under it. */}
            <section className="k-card overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-k-line-2 px-5 py-4">
                <div className="min-w-0">
                  <h1 className="text-[20px] font-bold leading-tight text-k-primary">
                    {phaseName} <span className="text-k-mute-2">—</span>{" "}
                    {mod.name}
                  </h1>
                  <p className="mt-1.5 text-[12px] text-k-mute">
                    Phase{" "}
                    {PHASES.indexOf(phaseName as (typeof PHASES)[number]) + 1}{" "}
                    of {PHASES.length}
                    {phase?.assignee && (
                      <>
                        {" "}
                        · Owner{" "}
                        <span className="font-semibold text-k-ink">
                          {phase.assignee}
                        </span>
                      </>
                    )}
                    {phase?.targetDate && (
                      <>
                        {" "}
                        · Target{" "}
                        <span className="k-mono text-[11px] text-k-text-amber">
                          {fmtDate(phase.targetDate)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {phase &&
                  (canEdit && target ? (
                    <div className="w-[200px]">
                      <InlineSelect
                        target={target}
                        field="status"
                        label={`Status for ${phaseName}`}
                        value={phase.status}
                        options={STATUSES}
                        version={phase._v}
                        before={phase}
                        optionDisabled={(o) =>
                          o === "Completed" && !canCompletePhase(phase).ok
                        }
                      />
                    </div>
                  ) : (
                    <StatusPill status={phase.status} />
                  ))}
              </div>

              <PhaseTrack
                clientId={clientId}
                moduleId={moduleId}
                current={phaseName}
                phases={mod.phases ?? []}
              />
            </section>

            {!phase ? (
              <div className="mt-6">
                <EmptyState
                  title="This module has no row for this phase"
                  hint="Every module should carry all nine. This one is missing."
                />
              </div>
            ) : (
              // A container query rather than a viewport one — the split sits
              // inside the tracker column and now re-decides for itself when
              // that column is resized. See .k-split.
              <SplitPane
                pane="phaseDetail"
                label="Resize phase record rail"
                className="mt-6"
                main={
                  <>
                    <section className="k-card px-5 py-4">
                      <h2 className="k-eyebrow">Sign-off checklist</h2>
                      <Checklist phase={phase} />
                      <SignoffNotice phase={phase} />
                    </section>

                    <section className="k-card p-4" ref={updatesRef}>
                      <div className="k-card-head">
                        <h2 className="k-card-title">Updates</h2>
                        <span className="k-mono text-[11px] text-k-mute">
                          {phase.updates?.length ?? 0}
                        </span>
                      </div>
                      <div className="mt-3">
                        <ActivityFeed
                          entries={phase.updates ?? []}
                          parentKind="phase"
                          parentId={phase.id}
                          clientId={clientId}
                        />
                      </div>
                    </section>
                  </>
                }
                rail={
                  <>
                    <section className="k-card px-4 py-3.5">
                      <h2 className="k-eyebrow">Phase record</h2>
                      <dl className="mt-2">
                        <F label="Owner">
                          <div ref={assigneeRef}>
                            {canEdit && target ? (
                              <InlineSelect
                                target={target}
                                field="assignee"
                                label="Assignee"
                                value={phase.assignee ?? ""}
                                options={assignees}
                                version={phase._v}
                                before={phase}
                                emptyLabel="Unassigned"
                                unknownSuffix="(not a current user)"
                              />
                            ) : (
                              phase.assignee || <Dash />
                            )}
                          </div>
                        </F>
                        <F label="Start">
                          {canEdit && target ? (
                            <InlineText
                              target={target}
                              field="startDate"
                              kind="date"
                              label="Start date"
                              value={phase.startDate ?? ""}
                              version={phase._v}
                              before={phase}
                              nullable
                              format={fmtDate}
                            />
                          ) : phase.startDate ? (
                            fmtDate(phase.startDate)
                          ) : (
                            <Dash />
                          )}
                        </F>
                        <F label="Target">
                          {canEdit && target ? (
                            <InlineText
                              target={target}
                              field="targetDate"
                              kind="date"
                              label="Target date"
                              value={phase.targetDate ?? ""}
                              version={phase._v}
                              before={phase}
                              nullable
                              format={fmtDate}
                            />
                          ) : phase.targetDate ? (
                            fmtDate(phase.targetDate)
                          ) : (
                            <Dash />
                          )}
                        </F>
                        <F label="Current activity">
                          {canEdit && target ? (
                            <InlineText
                              target={target}
                              field="currentActivity"
                              kind="textarea"
                              label="Current activity"
                              value={phase.currentActivity ?? ""}
                              version={phase._v}
                              before={phase}
                            />
                          ) : (
                            phase.currentActivity || <Dash />
                          )}
                        </F>
                        <F label="Next action">
                          {canEdit && target ? (
                            <InlineText
                              target={target}
                              field="nextAction"
                              kind="textarea"
                              label="Next action"
                              value={phase.nextAction ?? ""}
                              version={phase._v}
                              before={phase}
                            />
                          ) : (
                            phase.nextAction || <Dash />
                          )}
                        </F>
                      </dl>
                    </section>

                    <Actions
                      clientId={clientId}
                      phase={phase}
                      canEdit={canEdit}
                      onLogUpdate={() => focusWithin(updatesRef, "textarea")}
                      onReassign={() => focusWithin(assigneeRef, "select")}
                    />
                  </>
                }
              />
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

/**
 * The nine-step track.
 *
 * Built from the PHASES constant rather than from `module.phases`, so a module
 * with a missing row still shows all nine steps with a gap where the row should
 * be — the alternative silently renumbers the sequence.
 */
function PhaseTrack({
  clientId,
  moduleId,
  current,
  phases,
}: {
  clientId: string;
  moduleId: string;
  current: string;
  phases: Phase[];
}) {
  const byName = new Map(phases.map((p) => [p.name, p] as const));
  const currentIndex = PHASES.indexOf(current as (typeof PHASES)[number]);

  return (
    <nav aria-label="Phase sequence" className="overflow-x-auto px-5 py-4">
      <ol className="flex min-w-[820px] items-stretch gap-1">
        {PHASES.map((name, i) => {
          const p = byName.get(name);
          const isCurrent = name === current;
          const done = p?.status === "Completed";

          // 1f's track states POSITION IN THE SEQUENCE, not status: done behind
          // you, amber where you are, flat line ahead. The matrix is where each
          // phase's own status lives, and colouring the future steps by status
          // here made the two screens compete to answer the same question.
          const bar = done
            ? "var(--k-fill-ok)"
            : isCurrent
              ? "var(--k-fill-warn)"
              : "var(--k-line)";

          return (
            <li key={name} className="min-w-0 flex-1">
              <Link
                href={`/implementation/${clientId}/${moduleId}/${encodeURIComponent(name)}`}
                aria-current={isCurrent ? "step" : undefined}
                title={`${name} — ${p ? p.status : "not present"}`}
                className="block rounded-[4px] px-1 py-1 transition-colors hover:bg-k-surface"
              >
                <span
                  aria-hidden
                  className="block rounded-[2px]"
                  style={{ height: 4, background: bar }}
                />
                <span
                  className={`mt-1.5 flex items-start justify-center gap-1 text-center text-[9px] leading-[1.2] ${
                    isCurrent
                      ? "font-bold text-k-text-amber"
                      : i < currentIndex
                        ? "text-k-mute"
                        : "text-k-mute-2"
                  }`}
                >
                  {done && (
                    <Check
                      size={9}
                      strokeWidth={2}
                      aria-hidden
                      className="mt-px shrink-0"
                    />
                  )}
                  <span className="min-w-0">{shortPhase(name)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * 1f's Actions card.
 *
 * "Mark signed off" is the only new write: a PATCH of `status: "Completed"`.
 * It is disabled with the gate's own reason rather than hidden, because a
 * button that vanishes teaches nothing — and the server runs the identical
 * check, so a client that ignored this would still be refused.
 */
function Actions({
  clientId,
  phase,
  canEdit,
  onLogUpdate,
  onReassign,
}: {
  clientId: string;
  phase: Phase;
  canEdit: boolean;
  onLogUpdate: () => void;
  onReassign: () => void;
}) {
  const update = useUpdateEntity("phase", clientId, phase.id, {
    path: `/api/phases/${encodeURIComponent(phase.id)}`,
    screen: "implementation",
    onFailure: () => toast.error("Could not complete that phase."),
  });

  if (!canEdit) return null;

  const gate = canCompletePhase({ ...phase, status: "Completed" } as Phase);
  const done = phaseSignedOff(phase);
  // `_v` is optional on the DTO; without it the PATCH is refused with a 428.
  const blocked = !gate.ok || !phase._v;
  const reason = !gate.ok
    ? gate.reason
    : !phase._v
      ? "This phase has no version token, so it cannot be saved."
      : undefined;

  return (
    <section className="k-card px-4 py-3.5">
      <h2 className="k-eyebrow">Actions</h2>
      <div className="mt-3 flex flex-col gap-2">
        {!done && (
          <button
            type="button"
            className="k-btn k-btn-primary !h-[34px] justify-center"
            disabled={blocked || update.isPending}
            title={reason}
            onClick={() =>
              update.mutate(
                { version: phase._v!, patch: { status: "Completed" } },
                { onSuccess: () => toast.success("Phase marked signed off.") },
              )
            }
          >
            {update.isPending ? "Saving…" : "Mark signed off"}
          </button>
        )}
        <button
          type="button"
          className="k-btn k-btn-outline !h-[34px] justify-center"
          onClick={onLogUpdate}
        >
          Log an update
        </button>
        <button
          type="button"
          className="k-btn k-btn-outline !h-[34px] justify-center"
          onClick={onReassign}
        >
          Reassign
        </button>
      </div>
      {blocked && !done && reason && (
        <p className="mt-2 text-[11px] text-k-text-amber">{reason}</p>
      )}
    </section>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-k-line-2 py-2 last:border-b-0">
      <dt className="shrink-0 text-[11.5px] text-k-mute">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap text-right text-[12px] font-semibold text-k-ink">
        {children}
      </dd>
    </div>
  );
}

/** Scroll a control into view and put the cursor in it. */
function focusWithin(ref: RefObject<HTMLDivElement | null>, selector: string) {
  const el = ref.current?.querySelector<HTMLElement>(selector);
  ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.focus();
}

function Dash() {
  return <span className="text-k-mute">—</span>;
}
