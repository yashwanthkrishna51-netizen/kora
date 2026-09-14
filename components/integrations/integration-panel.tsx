"use client";

import Link from "next/link";
import { ArrowRight, Calendar, Zap } from "lucide-react";
import { StatusPill } from "@/components/ui/status";
import { InlineSelect } from "@/components/ui/inline";
import { ArchiveButton } from "@/components/ui/archive-button";
import { useCanEdit, useAssigneeOptions } from "@/lib/query/permissions";
import { fmtDate } from "@/lib/utils/dates";
import { STATUSES } from "@/lib/domain/constants";
import {
  isOverdue,
  daysOverdue,
  integMilestoneCounts,
  lastUpdateDate,
  effortLabel,
  EFFORT_STEPS,
} from "@/lib/domain/integrations";
import type { Integration } from "@/lib/domain/types";

/**
 * One integration's record, beside the list rather than instead of it.
 *
 * A SUMMARY, NOT THE RECORD, and the footer says so rather than leaving you to
 * find out. The full page keeps everything that needs room — milestone editing,
 * the update composer, attachments — and rebuilding those here would be a
 * second implementation of rules that already exist in one place.
 *
 * What is here is what you want while moving down the list: the two fields the
 * table never had room for (`nextAction`, `description`), the numbers, the last
 * few updates, and the three things worth changing without leaving the screen.
 */
export function IntegrationPanel({
  clientId,
  integration,
  onArchived,
}: {
  clientId: string;
  integration: Integration;
  /** Clear the selection — the record it pointed at is gone. */
  onArchived: () => void;
}) {
  const canEdit = useCanEdit();
  const assignees = useAssigneeOptions(integration.assignee);

  const ms = integMilestoneCounts(integration);
  const last = lastUpdateDate(integration);
  const overdue = isOverdue(integration);
  const href = `/integrations/${encodeURIComponent(clientId)}/${encodeURIComponent(integration.id)}`;

  const target = {
    kind: "integration" as const,
    clientId,
    id: integration.id,
    path: `/api/integrations/${encodeURIComponent(integration.id)}`,
    screen: "integrations" as const,
  };

  // Three, not all of them. The full record is where a history is read; this
  // answers "has anyone touched it".
  const recent = (integration.timeline ?? []).slice(0, 3);

  return (
    <section
      className="k-card k-record-panel p-5"
      aria-label={`${integration.name} record`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill status={integration.status} />
        <div className="flex items-center gap-2">
          {/* ARCHIVE LIVES HERE NOW. It was the table's last column, and the
              full record page has never had one — dropping it with the table
              would have left no way to archive an integration anywhere in the
              app. Beside the record it acts on is where it belonged anyway. */}
          {canEdit && (
            <ArchiveButton
              path={target.path}
              version={integration._v}
              label={integration.name}
              cascade={
                ms.total > 0
                  ? `Its ${ms.total} milestone${ms.total === 1 ? "" : "s"} go with it.`
                  : undefined
              }
              onArchived={onArchived}
              screen="integrations"
            />
          )}
          <Link href={href} className="k-btn k-btn-primary k-btn-sm">
            Open full record
            <ArrowRight size={13} strokeWidth={1.5} aria-hidden />
          </Link>
        </div>
      </div>

      <hr className="my-4 border-k-line-2" />

      <h2 className="text-[20px] font-bold leading-tight text-k-ink">
        {integration.name}
      </h2>
      {integration.description && (
        <p className="mt-2 text-[13px] leading-[1.55] text-k-mute">
          {integration.description}
        </p>
      )}

      {/* THE FIRST THING YOU SHOULD SEE, and built to be.
          
          A status tells you where a record stands; only this tells you what
          happens next, and it is the reason anyone opens the panel rather than
          reading the row. It was `.k-callout` — 12px `--k-ink-3` on a 5% tint —
          which reads as a footnote next to the field boxes below it. The action
          is now the largest text in the panel after the name, at full `--k-ink`
          weight, with the accent doubled so the eye lands here on the way down
          from the title. The reference draws a lightning bolt emoji; house rule
          is Lucide. */}
      {integration.nextAction && (
        <section className="mt-4 rounded-k border-l-4 border-k-primary bg-k-primary/[.10] px-4 py-3.5">
          <h3 className="k-eyebrow flex items-center gap-1.5 text-k-primary">
            <Zap size={13} strokeWidth={2} aria-hidden />
            Next action
          </h3>
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] font-medium leading-[1.5] text-k-ink">
            {integration.nextAction}
          </p>
        </section>
      )}

      <dl className="k-panel-grid mt-5">
        <Box label="Status">
          {canEdit ? (
            <InlineSelect
              target={target}
              field="status"
              label={`Status for ${integration.name}`}
              value={integration.status}
              options={STATUSES}
              version={integration._v}
              before={integration}
            />
          ) : (
            <span className="k-field">{integration.status}</span>
          )}
        </Box>

        <Box label="Assignee">
          {canEdit ? (
            <InlineSelect
              target={target}
              field="assignee"
              label={`Assignee for ${integration.name}`}
              value={integration.assignee ?? ""}
              options={assignees}
              emptyLabel="Unassigned"
              unknownSuffix="(not a current user)"
              nullable
              version={integration._v}
              before={integration}
            />
          ) : (
            <span className="k-field">
              {integration.assignee || (
                <span className="text-k-mute">Unassigned</span>
              )}
            </span>
          )}
        </Box>

        <Box label="Due date">
          <span
            className={`k-field gap-1.5 ${overdue ? "text-k-text-red" : ""}`}
          >
            <Calendar
              size={13}
              strokeWidth={1.5}
              aria-hidden
              className="shrink-0 text-k-mute"
            />
            {integration.dueDate ? (
              <>
                <span className="k-mono text-[12px]">
                  {fmtDate(integration.dueDate)}
                </span>
                {overdue && (
                  <span className="text-[11.5px] font-semibold">
                    {daysOverdue(integration)}d late
                  </span>
                )}
              </>
            ) : (
              <span className="text-k-mute">—</span>
            )}
          </span>
        </Box>

        <Box label="Effort load">
          {canEdit ? (
            <InlineSelect
              target={target}
              field="effortWeight"
              label={`Effort load for ${integration.name}`}
              // A NUMBER field: the select must post 0.5, not "0.5", or the
              // schema's z.number() rejects it. See `kind` in ui/inline.tsx.
              kind="number"
              value={
                integration.effortWeight != null
                  ? String(integration.effortWeight)
                  : ""
              }
              options={EFFORT_STEPS.map((s) => s.value)}
              optionLabel={(v) => effortLabel(Number(v))}
              unknownSuffix="(custom)"
              version={integration._v}
              before={integration}
            />
          ) : (
            <span className="k-field">{effortLabel(integration.effortWeight)}</span>
          )}
        </Box>

        <Box label="Last update">
          <span className="k-field">
            {last ? (
              <span className="k-mono text-[12px]">{fmtDate(last)}</span>
            ) : (
              <span className="text-k-mute">Never</span>
            )}
          </span>
        </Box>

        <Box label="Milestones">
          <span className="k-field gap-1.5">
            {ms.total ? (
              <>
                <span className="k-mono text-[12px]">
                  {ms.achieved}/{ms.total}
                </span>
                {ms.missed > 0 && (
                  <span className="text-[11.5px] text-k-text-red">
                    {ms.missed} missed
                  </span>
                )}
              </>
            ) : (
              <span className="text-k-mute">No milestones</span>
            )}
          </span>
        </Box>
      </dl>

      <h3 className="k-eyebrow mt-6">Recent activity feed</h3>
      {recent.length ? (
        <ul className="mt-2 space-y-2">
          {recent.map((e) => (
            <li key={e.id} className="k-field k-field-block">
              <p className="k-mono text-[11px] text-k-mute">
                {fmtDate(e.date)}
                {e.addedBy && <> · {e.addedBy}</>}
              </p>
              {e.update && (
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12.5px] text-k-ink-3">
                  {e.update}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12.5px] text-k-mute">No updates yet.</p>
      )}

      <hr className="mt-5 border-k-line-2" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-k-mute">
          Detailed timeline history and milestone configurations reside in the
          full record.
        </p>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-k-primary hover:underline"
        >
          View record
          <ArrowRight size={13} strokeWidth={1.5} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/**
 * An uppercase label over a bordered value box.
 *
 * `.k-label` + `.k-field` are both already in the stylesheet at exactly this
 * spec — the same pairing the full record's Field uses — so this is a
 * composition, not a new component's worth of styling.
 */
function Box({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="k-label">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
