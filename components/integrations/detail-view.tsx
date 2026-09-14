"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Check, Plus, Target } from "lucide-react";
import { toast } from "sonner";
import { useClient } from "@/lib/query/hooks";
import { QueryState, EmptyState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status";
import { ActivityFeed, fmtBytes } from "@/components/activity-feed";
import { SplitPane } from "@/components/ui/resizable";
import { AddMilestoneDialog } from "@/components/create/milestone-dialog";
import { useUpdateEntity } from "@/lib/query/mutations";
import { useCanEdit } from "@/lib/query/permissions";
import { fmtDate } from "@/lib/utils/dates";
import { STATUS_COLORS } from "@/lib/domain/constants";
import {
  isOverdue,
  daysOverdue,
  milestoneUrgency,
} from "@/lib/domain/integrations";
import type { Attachment, Integration, Milestone } from "@/lib/domain/types";

/**
 * One integration (artboard 1d): `1fr 300px` — milestones and activity on the
 * left, record and attachments on the right.
 *
 * Reads from the CLIENT tree rather than fetching the integration on its own.
 * There is no `GET /api/integrations/[id]` and there should not be: the tree is
 * already cached by the rail and every other screen, so this renders instantly
 * from cache when you arrive by clicking, and costs one request when you arrive
 * by deep link.
 */
export function IntegrationDetailView({
  clientId,
  integId,
}: {
  clientId: string;
  integId: string;
}) {
  const query = useClient(clientId);
  const client = query.data;
  const integration = client?.integrations?.find((i) => i.id === integId);
  const canEdit = useCanEdit();
  const [adding, setAdding] = useState(false);

  return (
    <div className="k-page">
      <QueryState
        isPending={query.isPending}
        isPaused={query.isPaused}
        error={query.error}
        onRetry={() => query.refetch()}
        skeletonRows={7}
      >
        {!integration ? (
          // A deep link to something archived or renamed. Says so, and offers
          // the way back, rather than rendering an empty shell.
          <EmptyState
            title="That integration is no longer here"
            hint="It may have been archived. Everything else for this client is still available."
          />
        ) : (
          <>
            <Link
              href={`/integrations/${clientId}`}
              className="mb-3 inline-flex items-center gap-1 text-[12px] text-k-mute hover:text-k-primary"
            >
              <ChevronLeft size={13} strokeWidth={1.5} aria-hidden />
              {client?.name ?? "Back"}
            </Link>

            {/* 1d's header: the status pill sits in the meta row beside the
                facts it qualifies, not off on the right as a fourth control.
                1d also draws a filled "Save" here; this app saves inline per
                field with OCC, so there is no dirty state for it to commit. */}
            <header>
              <h1 className="k-page-title min-w-0">{integration.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-k-mute">
                <StatusPill status={integration.status} />
                <span>
                  Owner{" "}
                  <span className="font-semibold text-k-ink">
                    {integration.assignee || "Unassigned"}
                  </span>
                </span>
                {integration.dueDate && (
                  <>
                    <span aria-hidden className="text-k-mute-2">
                      ·
                    </span>
                    <span>
                      Due{" "}
                      <span
                        className={`k-mono text-[11px] ${
                          isOverdue(integration)
                            ? "font-semibold text-k-text-red"
                            : "text-k-ink-3"
                        }`}
                      >
                        {fmtDate(integration.dueDate)}
                      </span>
                      {isOverdue(integration) && (
                        <span className="ml-1.5 text-k-text-red">
                          {daysOverdue(integration)}d overdue
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
            </header>

            {canEdit && (
              <AddMilestoneDialog
                clientId={clientId}
                integrationId={integration.id}
                integrationName={integration.name}
                open={adding}
                onOpenChange={setAdding}
              />
            )}

            {/* A container query, not a viewport one — see .k-split. The rail
                is draggable and the split re-decides for itself when the client
                rail beside it moves, which a media query never could. */}
            <SplitPane
              pane="integDetail"
              label="Resize integration detail rail"
              className="mt-5"
              main={
                <>
                  <MilestonesCard
                    clientId={clientId}
                    milestones={integration.milestones ?? []}
                    canEdit={canEdit}
                    onAdd={() => setAdding(true)}
                  />

                  <section className="k-card">
                    <div className="k-card-head">
                      <h2 className="k-card-title">Activity &amp; updates</h2>
                      <span className="k-mono text-[11px] text-k-mute">
                        {integration.timeline?.length ?? 0}
                      </span>
                    </div>
                    <div className="p-4">
                      <ActivityFeed
                        entries={integration.timeline ?? []}
                        variant="timeline"
                        dotColor={
                          (
                            STATUS_COLORS[integration.status] ??
                            STATUS_COLORS["Not Started"]
                          ).fill
                        }
                        parentKind="integration"
                        parentId={integration.id}
                        clientId={clientId}
                      />
                    </div>
                  </section>

                  {/* Not on 1d — the mockup's integration had neither field. Both
                    are real and already on screen, so they stay, below the two
                    cards the artboard does draw. */}
                  {(integration.description || integration.nextAction) && (
                    <section className="k-card p-4">
                      {integration.description && (
                        <>
                          <h2 className="k-eyebrow">Description</h2>
                          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-k-ink-3">
                            {integration.description}
                          </p>
                        </>
                      )}
                      {integration.nextAction && (
                        <>
                          <h2
                            className={`k-eyebrow ${integration.description ? "mt-3" : ""}`}
                          >
                            Next action
                          </h2>
                          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-k-ink-3">
                            {integration.nextAction}
                          </p>
                        </>
                      )}
                    </section>
                  )}
                </>
              }
              rail={
                <>
                  <section className="k-card p-4">
                    <h2 className="k-eyebrow">Record</h2>
                    <dl className="mt-3 space-y-3">
                      <Field label="Assignee" value={integration.assignee} />
                      <Field
                        label="Due date"
                        value={
                          integration.dueDate
                            ? fmtDate(integration.dueDate)
                            : undefined
                        }
                        tone={
                          isOverdue(integration) ? "text-k-text-red" : undefined
                        }
                      />
                      <Field
                        label="Effort weight"
                        value={integration.effortWeight?.toString()}
                      />
                      <Field
                        label="Created"
                        value={
                          integration.createdAt
                            ? fmtDate(integration.createdAt)
                            : undefined
                        }
                      />
                    </dl>
                  </section>

                  <AttachmentsCard integration={integration} />
                </>
              }
            />
          </>
        )}
      </QueryState>
    </div>
  );
}

/**
 * 1d's read-mode record field: an 11px label over a 32px value box.
 *
 * `.k-field` is that box, already in the stylesheet at exactly this spec, and
 * previously used nowhere.
 */
function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] text-k-mute">{label}</dt>
      <dd className={`k-field mt-1.5 ${tone ?? ""}`}>
        {value || <span className="text-k-mute">—</span>}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------- milestones */

function MilestonesCard({
  clientId,
  milestones,
  canEdit,
  onAdd,
}: {
  clientId: string;
  milestones: Milestone[];
  canEdit: boolean;
  onAdd: () => void;
}) {
  return (
    <section className="k-card">
      <div className="k-card-head">
        <h2 className="k-card-title">Milestones</h2>
        {canEdit ? (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-k-primary hover:underline"
          >
            <Plus size={12} strokeWidth={1.5} aria-hidden />
            Add milestone
          </button>
        ) : (
          <span className="k-mono text-[11px] text-k-mute">
            {milestones.length}
          </span>
        )}
      </div>

      {milestones.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No milestones"
            hint={canEdit ? "Add one to track a dated commitment." : undefined}
            icon={Target}
          />
        </div>
      ) : (
        <ul>
          {milestones.map((m) => (
            <MilestoneRow
              key={m.id}
              clientId={clientId}
              milestone={m}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * `milestoneUrgency` is the domain function the old app used to decide whether
 * a pending milestone was worth flagging; reusing it means this row and the
 * dashboard's deadline tile agree about what "due soon" means.
 *
 * It returns "rose" | "orange" | "amber" — v1's own Tailwind palette names,
 * preserved by the port because the golden tests diff against the original
 * function's output. They are NOT Kognoz tokens and mean nothing in this
 * design, so they are mapped here rather than used as class names: rose is
 * past due, orange is due within three days, amber is everything else.
 */
const URGENCY_TONE = {
  rose: "text-k-text-red",
  orange: "text-k-text-amber",
  amber: "text-k-mute",
} as const;

const MS_TINT: Record<string, { bg: string; fg: string }> = {
  Achieved: { bg: "var(--k-tint-green)", fg: "var(--k-text-green)" },
  Missed: { bg: "var(--k-tint-risk)", fg: "var(--k-text-red)" },
  Pending: { bg: "var(--k-line-2)", fg: "var(--k-ink-3)" },
};

/**
 * One milestone — 1d's `22px 1fr 96px 96px` row.
 *
 * THE CHECKBOX IS THE FIRST MILESTONE WRITE IN THE APP. The route, the schema
 * and the `"milestone"` branch of the mutation cache have all existed since the
 * tracker was built with nothing in the browser able to reach them.
 *
 * It toggles Pending <-> Achieved and NOTHING ELSE. Missed renders as an
 * unchecked box with a red border and is left alone: a checkbox that silently
 * turned "we missed this" into "done" would erase the one milestone state
 * anybody reports on, and there is no undo. Changing a Missed milestone stays a
 * deliberate act, through the dialog.
 */
function MilestoneRow({
  clientId,
  milestone,
  canEdit,
}: {
  clientId: string;
  milestone: Milestone;
  canEdit: boolean;
}) {
  const update = useUpdateEntity("milestone", clientId, milestone.id, {
    path: `/api/milestones/${encodeURIComponent(milestone.id)}`,
    screen: "integrations",
    onFailure: () => toast.error("Could not change that milestone."),
  });

  const achieved = milestone.status === "Achieved";
  const missed = milestone.status === "Missed";
  const tone = achieved
    ? "text-k-text-green"
    : missed
      ? "text-k-text-red"
      : URGENCY_TONE[milestoneUrgency(milestone)];

  // `_v` is optional on the DTO; without it the PATCH would be refused with a
  // 428, so the control disables itself rather than failing on click.
  const toggleable = canEdit && !missed && Boolean(milestone._v);

  const box = (
    <span
      className="k-check"
      data-checked={achieved ? "true" : "false"}
      style={missed ? { borderColor: "var(--k-fill-risk)" } : undefined}
      aria-hidden
    >
      {achieved && <Check size={11} strokeWidth={2.5} />}
    </span>
  );

  return (
    <li className="grid grid-cols-[22px_1fr_96px_96px] items-center gap-2.5 border-b border-k-line-2 px-4 py-[11px] last:border-b-0">
      {toggleable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={achieved}
          aria-label={`${milestone.name} achieved`}
          disabled={update.isPending}
          onClick={() =>
            update.mutate({
              version: milestone._v!,
              patch: { status: achieved ? "Pending" : "Achieved" },
            })
          }
        >
          {box}
        </button>
      ) : (
        box
      )}

      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-medium text-k-ink">
          {milestone.name}
        </p>
        {(milestone.owner || milestone.notes) && (
          <p className="truncate text-[10.5px] text-k-mute-2">
            {[milestone.owner, milestone.notes].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <span className={`k-mono text-[11px] ${tone}`}>
        {milestone.dueDate ? fmtDate(milestone.dueDate) : "—"}
      </span>

      <span
        className="k-status justify-self-start"
        style={{
          background: MS_TINT[milestone.status]?.bg,
          color: MS_TINT[milestone.status]?.fg,
        }}
      >
        {milestone.status}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------ attachments */

/**
 * Every file on this integration, gathered from its updates.
 *
 * ATTACHMENTS HANG OFF ACTIVITY ENTRIES. There is no free-floating attachment
 * in the model, which is also why the dashed panel below is a legend and not a
 * drop target: a dropped file would have nowhere to go without inventing an
 * update to carry it, and this pass does not change write semantics.
 */
function AttachmentsCard({ integration }: { integration: Integration }) {
  const files = (integration.timeline ?? [])
    .map((e) => (e.attachment ? { ...e.attachment, date: e.date } : null))
    .filter((f): f is Attachment & { date: string } => f !== null);

  return (
    <section className="k-card p-4">
      <h2 className="k-eyebrow">Attachments</h2>

      {files.length > 0 && (
        <ul className="mt-3">
          {files.map((f) => (
            <li
              key={f.storagePath}
              className="flex items-center gap-2.5 border-b border-k-line-2 py-2 last:border-b-0"
            >
              <span
                className="k-tag shrink-0"
                style={{
                  background: "var(--k-primary-08)",
                  color: "var(--k-primary)",
                }}
              >
                {extOf(f.fileName)}
              </span>
              {/* The href is the SIGNED url; when signing failed it degrades to
                  plain text rather than a link that 400s. */}
              {f.url ? (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-[12px] text-k-ink hover:text-k-primary hover:underline"
                >
                  {f.fileName}
                </a>
              ) : (
                <span
                  className="min-w-0 flex-1 truncate text-[12px] text-k-mute"
                  title="This file could not be prepared for download just now"
                >
                  {f.fileName}
                </span>
              )}
              <span className="shrink-0 text-[10.5px] text-k-mute-2">
                {f.sizeBytes ? fmtBytes(f.sizeBytes) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 rounded-[4px] border border-dashed border-k-field px-3 py-3.5 text-center text-[11.5px] text-k-mute">
        {files.length === 0 ? "No files yet. " : ""}
        Attach files to an update — links expire in 4h
      </p>
    </section>
  );
}

/** `PDF` / `XLSX` / `MSG`, for the mono chip. */
function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "FILE";
  return fileName
    .slice(dot + 1)
    .toUpperCase()
    .slice(0, 4);
}
