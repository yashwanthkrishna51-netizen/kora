"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useClient } from "@/lib/query/hooks";
import { useUi } from "@/lib/store/ui";
import { QueryState, EmptyState } from "@/components/ui/states";
import { DateField } from "@/components/ui/date-field";
import { SplitPane } from "@/components/ui/resizable";
import { RagPill, QueryLevelPill } from "@/components/ui/status";
import { ExportMenu } from "@/components/export-menu";
import { toast } from "sonner";
import { InlineSelect, InlineText } from "@/components/ui/inline";
import { ArchiveButton } from "@/components/ui/archive-button";
import { AddWorkLogDialog } from "@/components/create/work-log-dialog";
import { useCanEdit, useSession } from "@/lib/query/permissions";
import { fmtDate } from "@/lib/utils/dates";
import {
  AMS_QUERY_LEVELS,
  AMS_TYPES,
  AMS_ENTRY_STATUSES,
  STATUS_COLORS,
} from "@/lib/domain/constants";
import {
  amsTotals,
  amsClientRag,
  amsOpenCounts,
  amsWorkMix,
  poolGaugeColor,
  currencySymbol,
  entryDate,
  entryType,
  entryRaisedBy,
} from "@/lib/domain/ams";
import type { AmsTotals } from "@/lib/domain/ams";
import type { WorkLogEntry } from "@/lib/domain/types";

/**
 * AMS & Support for one client (artboard 1g): `300px 1fr` — the retainer gauge,
 * severity mix and work-mix donut on the left, the work log on the right.
 *
 * EVERY NUMBER COMES FROM `amsTotals`, which carries the one rule that makes
 * this domain non-obvious: hours consume the retainer pool FIRST and only the
 * overage is billable, with the pool drawn down chronologically — so hours
 * logged before the selected window still count against it. Recomputing any of
 * that here would be a second implementation of the billing maths, which is
 * the last thing that should exist twice.
 */
export function AmsClientView({ clientId }: { clientId: string }) {
  const query = useClient(clientId);
  const client = query.data;

  // The window is all-time by default. v1 defaulted to the current month,
  // which quietly hid every entry the moment the month turned over.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const canEdit = useCanEdit();
  const session = useSession();
  const rememberClient = useUi((s) => s.rememberClient);

  // Recorded on arrival rather than on a rail click, so a typed URL, a
  // bookmark and a link from the palette all count as "where I was". `/ams`
  // with no client reopens this one.
  useEffect(() => {
    rememberClient("ams", clientId);
  }, [clientId, rememberClient]);
  const [addingEntry, setAddingEntry] = useState(false);

  const totals = useMemo(
    () => (client ? amsTotals(client, from, to) : null),
    [client, from, to],
  );

  return (
    <div className="p-7">
      <QueryState
        isPending={query.isPending}
        isPaused={query.isPaused}
        error={query.error}
        onRetry={() => query.refetch()}
        skeletonRows={8}
      >
        {client && totals && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="k-page-title truncate">{client.name}</h1>
                <p className="mt-1 text-[12.5px] text-k-mute">
                  {amsOpenCounts(client).open} open ·{" "}
                  {client.workLog?.length ?? 0} entries all time
                </p>
              </div>
              <div className="flex items-center gap-3">
                {amsClientRag(client) && (
                  <RagPill rag={amsClientRag(client)!} />
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="k-btn k-btn-primary k-btn-sm"
                    onClick={() => setAddingEntry(true)}
                  >
                    <Plus size={13} strokeWidth={1.5} aria-hidden />
                    Entry
                  </button>
                )}
              </div>
            </header>

            <AddWorkLogDialog
              clientId={clientId}
              clientName={client.name}
              open={addingEntry}
              onOpenChange={setAddingEntry}
            />

            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="k-field">
                <span className="k-label">From</span>
                <DateField
                  label="From date"
                  value={from}
                  onChange={setFrom}
                  className="k-input k-input-sm"
                />
              </label>
              <label className="k-field">
                <span className="k-label">To</span>
                <DateField
                  label="To date"
                  value={to}
                  onChange={setTo}
                  className="k-input k-input-sm"
                />
              </label>
              {(from || to) && (
                <button
                  type="button"
                  onClick={() => {
                    setFrom("");
                    setTo("");
                  }}
                  className="k-btn k-btn-ghost k-btn-sm"
                >
                  All time
                </button>
              )}

              {/* ADMIN ONLY, exactly as v1 gated it: the whole AMS export menu
                  sat inside `can('admin')`, so an editor never saw one. These
                  reports carry the hours a client is billed for. `useSession`
                  is not a security boundary, but nothing here is server-side
                  either — the generation is entirely client-side over data the
                  person can already read on this screen. */}
              {session?.role === "admin" && (
                <div className="ml-auto">
                  <ExportMenu
                    items={[
                      {
                        label: "Activity Report (PDF)",
                        disabledReason: totals?.log.length
                          ? undefined
                          : "no entries",
                        run: async () => {
                          const { exportAmsActivityPdf } =
                            await import("@/lib/export/ams-pdf");
                          await exportAmsActivityPdf(client, { from, to });
                          toast.success("Report downloaded.");
                        },
                      },
                      {
                        label: "Excel (Work log)",
                        disabledReason: (client.workLog ?? []).length
                          ? undefined
                          : "no entries",
                        run: async () => {
                          const { exportClientExcel } =
                            await import("@/lib/export/excel");
                          await exportClientExcel("ams", client);
                          toast.success("Spreadsheet downloaded.");
                        },
                      },
                    ]}
                  />
                </div>
              )}
            </div>

            {/* The rail is on the LEFT here, unlike the other two trackers —
                the retainer gauge is the thing you look at first. SplitPane
                takes railSide for that, and puts the handle on the correct
                side so dragging right still grows the rail. */}
            <SplitPane
              pane="amsRail"
              railSide="start"
              label="Resize retainer rail"
              className="mt-5"
              rail={
                <>
                  <RetainerGauge client={client} totals={totals} />
                  <SeverityMix client={client} />
                  <WorkMix totals={totals} />
                </>
              }
              main={
                <section className="k-card min-w-0 overflow-hidden">
                  <div className="k-card-head px-4 pt-4">
                    <h2 className="k-card-title">Work log</h2>
                    <span className="k-mono text-[11px] text-k-mute">
                      {totals.log.length}
                    </span>
                  </div>
                  {totals.log.length === 0 ? (
                    <EmptyState
                      title="No entries in this window"
                      hint={
                        from || to
                          ? "Widen the dates, or clear them to see everything."
                          : "This client is in AMS but has nothing logged yet."
                      }
                    />
                  ) : (
                    <WorkLogTable
                      entries={totals.log}
                      clientId={clientId}
                      canEdit={canEdit}
                    />
                  )}
                </section>
              }
            />
          </>
        )}
      </QueryState>
    </div>
  );
}

/**
 * The semicircular retainer gauge, 200×112.
 *
 * An SVG arc rather than a chart library: it is one path, it inherits the theme
 * tokens, and the export bundle stays out of the main chunk. The sweep is
 * capped at 100% so an overdrawn retainer does not wrap around the dial and
 * read as healthy — the overage is stated in words underneath instead, which
 * is the number that actually costs money.
 */
function RetainerGauge({
  client,
  totals,
}: {
  client: { currency?: string; manDayRate?: number };
  totals: AmsTotals;
}) {
  const pool = totals.totalAvailableHours ?? 0;
  const consumed = totals.consumedAllTime;
  const pct = pool > 0 ? (consumed / pool) * 100 : 0;
  const capped = Math.min(100, pct);
  const colour = poolGaugeColor(pct);

  // Semicircle from 180° to 0°, radius 88 in a 200×112 box.
  const R = 88;
  const CX = 100;
  const CY = 100;
  const arc = (endPct: number) => {
    const a = Math.PI * (1 - endPct / 100);
    return `${CX + R * Math.cos(a)} ${CY - R * Math.sin(a)}`;
  };
  const track = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  const value = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${arc(capped)}`;

  return (
    <section className="k-card p-4">
      <h2 className="k-card-title">Retainer</h2>

      {pool <= 0 ? (
        <p className="mt-3 text-[12px] text-k-mute">
          No retainer pool set for this client — all hours are billable.
        </p>
      ) : (
        <>
          <svg
            viewBox="0 0 200 112"
            className="mx-auto mt-3 block"
            style={{ width: 200, height: 112 }}
            role="img"
            aria-label={`${Math.round(pct)} percent of the retainer consumed`}
          >
            <path
              d={track}
              fill="none"
              stroke="var(--k-line-2)"
              strokeWidth={14}
              strokeLinecap="round"
            />
            {capped > 0 && (
              <path
                d={value}
                fill="none"
                stroke={colour}
                strokeWidth={14}
                strokeLinecap="round"
              />
            )}
          </svg>

          <p className="-mt-6 text-center">
            <span className="k-num text-[26px] leading-none">
              {Math.round(pct)}%
            </span>
            <span className="mt-1 block text-[11px] text-k-mute">
              {round(consumed)} of {round(pool)} h used
            </span>
          </p>

          {pct > 100 && (
            <p className="mt-2 text-center text-[11.5px] font-semibold text-k-text-red">
              {round(consumed - pool)} h over the retainer
            </p>
          )}
        </>
      )}

      <dl className="mt-4 space-y-2 border-t border-k-line-2 pt-3">
        <Row label="Hours in window" value={`${round(totals.totalHours)} h`} />
        <Row
          label="Covered by pool"
          value={`${round(totals.coveredHours)} h`}
        />
        <Row label="Billable" value={`${round(totals.billableHours)} h`} />
        {totals.balanceAvailable !== null && (
          <Row
            label="Pool remaining"
            value={`${round(totals.balanceAvailable)} h`}
          />
        )}
        {totals.totalAmount !== null && (
          <Row
            label="Amount"
            value={`${currencySymbol(client as never)}${totals.totalAmount.toLocaleString()}`}
            strong
          />
        )}
      </dl>

      {!totals.hasRate && (
        <p className="mt-2 text-[11px] text-k-mute">
          No day rate set, so no amount can be calculated.
        </p>
      )}
    </section>
  );
}

/** Open entries by severity — the bar the dashboard also draws. */
function SeverityMix({ client }: { client: { workLog?: WorkLogEntry[] } }) {
  const open = (client.workLog ?? []).filter(
    (e) => (e.entryStatus || "Open") !== "Closed",
  );

  const counts = AMS_QUERY_LEVELS.map((level) => ({
    level,
    n: open.filter((e) => e.queryLevel === level).length,
  }));
  const total = counts.reduce((a, c) => a + c.n, 0);

  return (
    <section className="k-card p-4">
      <div className="k-card-head">
        <h2 className="k-card-title">Open by severity</h2>
        <span className="k-mono text-[11px] text-k-mute">{total}</span>
      </div>

      {total === 0 ? (
        <p className="mt-3 text-[12px] text-k-mute">Nothing open.</p>
      ) : (
        <>
          <div
            className="mt-3 flex h-2 overflow-hidden rounded-[2px]"
            role="img"
            aria-label={counts
              .filter((c) => c.n)
              .map((c) => `${c.n} ${c.level}`)
              .join(", ")}
          >
            {counts
              .filter((c) => c.n > 0)
              .map((c) => (
                <span
                  key={c.level}
                  style={{
                    width: `${(c.n / total) * 100}%`,
                    background: severityFill(c.level),
                  }}
                />
              ))}
          </div>
          <ul className="mt-3 space-y-1.5">
            {counts
              .filter((c) => c.n > 0)
              .map((c) => (
                <li
                  key={c.level}
                  className="flex items-center justify-between gap-2"
                >
                  <QueryLevelPill level={c.level} />
                  <span className="k-mono text-[11.5px] text-k-ink-3">
                    {c.n}
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Reactive vs proactive, as a donut.
 *
 * DONUT, NOT PIE — the handoff is explicit, and no 3D. Drawn with two
 * stroke-dasharray arcs on one circle, which needs no library and scales
 * cleanly.
 */
function WorkMix({ totals }: { totals: AmsTotals }) {
  const mix = amsWorkMix(totals);
  const has = mix.reactive + mix.proactive > 0;

  const R = 42;
  const C = 2 * Math.PI * R;
  const reactiveLen = (mix.reactivePct / 100) * C;

  return (
    <section className="k-card p-4">
      <h2 className="k-card-title">Work mix</h2>

      {!has ? (
        <p className="mt-3 text-[12px] text-k-mute">No hours in this window.</p>
      ) : (
        <div className="mt-3 flex items-center gap-4">
          <svg
            viewBox="0 0 108 108"
            style={{ width: 108, height: 108 }}
            role="img"
            aria-label={`${mix.reactivePct} percent reactive, ${mix.proactivePct} percent proactive`}
            className="shrink-0"
          >
            <g transform="rotate(-90 54 54)">
              <circle
                cx={54}
                cy={54}
                r={R}
                fill="none"
                stroke="var(--k-teal)"
                strokeWidth={16}
              />
              <circle
                cx={54}
                cy={54}
                r={R}
                fill="none"
                stroke="var(--k-fill-warn)"
                strokeWidth={16}
                strokeDasharray={`${reactiveLen} ${C - reactiveLen}`}
              />
            </g>
          </svg>

          <ul className="min-w-0 space-y-2 text-[12px]">
            <MixRow
              colour="var(--k-fill-warn)"
              label="Reactive"
              pct={mix.reactivePct}
              hours={mix.reactive}
            />
            <MixRow
              colour="var(--k-teal)"
              label="Proactive"
              pct={mix.proactivePct}
              hours={mix.proactive}
            />
          </ul>
        </div>
      )}
    </section>
  );
}

function MixRow({
  colour,
  label,
  pct,
  hours,
}: {
  colour: string;
  label: string;
  pct: number;
  hours: number;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-full"
        style={{ width: 8, height: 8, background: colour }}
      />
      <span className="text-k-ink-3">{label}</span>
      <span className="k-mono text-k-mute">
        {pct}% · {round(hours)}h
      </span>
    </li>
  );
}

function WorkLogTable({
  entries,
  clientId,
  canEdit,
}: {
  entries: WorkLogEntry[];
  clientId: string;
  canEdit: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      {/* The editable table needs more room than the read-only one: a select
          must fit its longest option plus the chevron, and "Enhancement" /
          "L4 - Critical" truncated to "Enhan" / "L4 - Cr" at 760px. A viewer
          sees pills instead, so widening for them would only clip the table
          and force a scrollbar nobody needs. */}
      <table
        className={`w-full border-collapse text-[12.5px] ${
          canEdit ? "min-w-[980px]" : "min-w-[760px]"
        }`}
      >
        <thead>
          <tr className="k-thead">
            <th className="px-3 py-2 text-left font-semibold">Date</th>
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="w-[150px] px-3 py-2 text-left font-semibold">
              Type
            </th>
            <th className="w-[150px] px-3 py-2 text-left font-semibold">
              Severity
            </th>
            <th className="w-[130px] px-3 py-2 text-left font-semibold">
              Status
            </th>
            <th className="w-[100px] px-3 py-2 text-right font-semibold">
              Hours
            </th>
            {canEdit && <th className="w-[44px] px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const status = e.entryStatus || "Open";
            return (
              <tr key={e.id} className="k-row k-row-hover">
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="k-mono text-[11.5px] text-k-ink-3">
                    {fmtDate(entryDate(e))}
                  </span>
                </td>
                <td className="max-w-[320px] px-3 py-2.5">
                  <p className="truncate text-k-ink" title={e.description}>
                    {e.description || "—"}
                  </p>
                  {e.raisedBy && (
                    <p className="text-[11px] text-k-mute">
                      {entryRaisedBy(e)}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2.5 text-k-ink-3">
                  {canEdit ? (
                    <InlineSelect
                      target={targetFor(clientId, e.id)}
                      // The WIRE name is `type`; the column is `entry_type`.
                      // Sending `entryType` is a 400 from a `.strict()` schema.
                      field="type"
                      label="Type"
                      value={entryType(e)}
                      options={AMS_TYPES}
                      version={e._v}
                      before={e}
                      nullable
                    />
                  ) : (
                    entryType(e)
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {canEdit ? (
                    <InlineSelect
                      target={targetFor(clientId, e.id)}
                      field="queryLevel"
                      label="Severity"
                      value={e.queryLevel ?? ""}
                      options={AMS_QUERY_LEVELS}
                      version={e._v}
                      before={e}
                      emptyLabel="—"
                      nullable
                    />
                  ) : (
                    <QueryLevelPill level={e.queryLevel ?? null} />
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {canEdit ? (
                    <InlineSelect
                      target={targetFor(clientId, e.id)}
                      field="entryStatus"
                      label="Status"
                      value={status}
                      options={AMS_ENTRY_STATUSES}
                      version={e._v}
                      before={e}
                    />
                  ) : (
                    <span
                      className="k-status"
                      style={{
                        background:
                          status === "Closed"
                            ? "var(--k-tint-green)"
                            : "var(--k-tint-cyan)",
                        color:
                          status === "Closed"
                            ? "var(--k-text-green)"
                            : "var(--k-text-cyan)",
                        fontSize: 10,
                      }}
                    >
                      {status}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {canEdit ? (
                    <InlineText
                      target={targetFor(clientId, e.id)}
                      field="hours"
                      kind="number"
                      label="Hours"
                      value={String(e.hours ?? "")}
                      version={e._v}
                      before={e}
                    />
                  ) : (
                    <span className="k-mono text-[11.5px] text-k-ink">
                      {round(Number(e.hours || 0))}
                    </span>
                  )}
                </td>
                {canEdit && (
                  <td className="px-3 py-2.5">
                    <ArchiveButton
                      path={`/api/work-log/${encodeURIComponent(e.id)}`}
                      version={e._v}
                      label={e.description || "this entry"}
                      screen="ams"
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11.5px] text-k-mute">{label}</dt>
      <dd
        className={`k-mono text-[12px] ${strong ? "font-semibold text-k-ink" : "text-k-ink-3"}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Where a work-log PATCH goes. */
function targetFor(clientId: string, id: string) {
  return {
    kind: "workLog" as const,
    clientId,
    id,
    path: `/api/work-log/${encodeURIComponent(id)}`,
    screen: "ams",
  };
}

/** Severity fill, reusing the status hues (handoff §9). */
function severityFill(level: string): string {
  if (level.includes("L4")) return STATUS_COLORS["At Risk"].fill;
  if (level.includes("L3")) return STATUS_COLORS.Delayed.fill;
  if (level.includes("L2")) return STATUS_COLORS["In Progress"].fill;
  return STATUS_COLORS["On Hold — Internal"].fill;
}

/** Hours carry fractions; two decimals at most, and no trailing ".00". */
function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}
