"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { useClient } from "@/lib/query/hooks";
import { QueryState, EmptyState } from "@/components/ui/states";
import { StatusPill, RagPill } from "@/components/ui/status";
import { ExportMenu } from "@/components/export-menu";
import { toast } from "sonner";
import { SplitPane } from "@/components/ui/resizable";
import { IntegrationPanel } from "@/components/integrations/integration-panel";
import { useUi, useUiHydrated } from "@/lib/store/ui";
import { AddIntegrationDialog } from "@/components/create/integration-dialog";
import { ClientEmailDialog } from "@/components/integrations/client-email-dialog";
import { useCanEdit } from "@/lib/query/permissions";
import { fmtDate } from "@/lib/utils/dates";
import { STATUSES } from "@/lib/domain/constants";
import {
  integRagLabel,
  isOverdue,
  integRiskReason,
  pickLanding,
  sortIntegrations,
  INTEG_SORTS,
  type IntegSort,
} from "@/lib/domain/integrations";
import type { Integration } from "@/lib/domain/types";

/**
 * One client's integrations (artboard 1c).
 *
 * WORST FIRST, not alphabetical. `sortIntegWorstFirst` ranks by the same
 * severity the RAG uses, so the row most likely to need action is the one you
 * read first — a tracker sorted by name makes you scan all 29 to find the one
 * that is overdue. The old app sorted by insertion order, which is neither.
 */
export function IntegrationsClientView({ clientId }: { clientId: string }) {
  const query = useClient(clientId);
  const [filter, setFilter] = useState<string>("all");
  const canEdit = useCanEdit();
  const [adding, setAdding] = useState(false);
  const [emailing, setEmailing] = useState(false);

  /**
   * WHICH ROW IS OPEN, tagged with the client it belongs to.
   *
   * Tagged, because this component is not remounted when you move between
   * clients — the route param changes and React reuses the instance — so a
   * bare id would leave the previous client's row "selected" against a list it
   * is not in. Comparing the tag means arriving at a client is indistinguishable
   * from arriving fresh, which is what makes the derivation below need no
   * effect: no `setState` in a `useEffect`, no cascading render, no flash of a
   * panel belonging to the client you just left.
   *
   * `integId: null` is "closed on purpose" and is NOT the same as no entry —
   * without that distinction, closing the panel would immediately reopen it on
   * the fallback.
   */
  const [sel, setSel] = useState<{
    clientId: string;
    integId: string | null;
  } | null>(null);

  const sort = useUi((s) => s.integSort);
  const setSort = useUi((s) => s.setIntegSort);
  const rememberClient = useUi((s) => s.rememberClient);
  const rememberInteg = useUi((s) => s.rememberIntegration);
  const rememberedInteg = useUi((s) => s.lastIntegration[clientId]);
  // Same reason as the landing: the stored slice arrives a tick after the first
  // render, and auto-selecting before it does would open the first row and then
  // visibly swap to the remembered one.
  const storeReady = useUiHydrated();

  // Recorded on arrival rather than on a rail click, so a typed URL, a
  // bookmark and a link from the palette all count as "where I was".
  useEffect(() => {
    rememberClient("integrations", clientId);
  }, [clientId, rememberClient]);

  const client = query.data;

  const all = useMemo(
    () => (client ? sortIntegrations(client.integrations ?? [], sort) : []),
    [client, sort],
  );

  // Chip counts describe the WHOLE set, not the filtered one — a chip that
  // recounts itself after you click it can only ever read "3 of 3".
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const i of all) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [all]);

  const shown = useMemo(
    () => (filter === "all" ? all : all.filter((i) => i.status === filter)),
    [all, filter],
  );

  const shownIds = useMemo(() => shown.map((i) => i.id), [shown]);

  /**
   * Derived, never stored. Three cases, in order:
   *   - closed on purpose for THIS client -> nothing;
   *   - a row picked for this client and still visible -> that row;
   *   - anything else (just arrived, or the filter hid the pick) -> where you
   *     were in this client, falling back to the first row.
   */
  const own = sel?.clientId === clientId ? sel : null;
  const selectedId =
    own?.integId === null
      ? null
      : own && shownIds.includes(own.integId)
        ? own.integId
        : storeReady
          ? (pickLanding(own ? undefined : rememberedInteg, shownIds) ?? null)
          : null;

  const selected = selectedId
    ? (shown.find((i) => i.id === selectedId) ?? null)
    : null;

  function pick(integId: string) {
    setSel({ clientId, integId });
    // Only an explicit pick is remembered. Persisting the auto-selection would
    // write a preference the user never expressed.
    rememberInteg(clientId, integId);
  }

  // Chips in STATUSES order, not alphabetical. That array is the app's
  // canonical status order — it already drives the very `InlineSelect` in the
  // Status column below — so a chip row sorted any other way would disagree
  // with the dropdown sitting two inches under it.
  const chipStatuses = useMemo(
    () => STATUSES.filter((st) => (counts[st] ?? 0) > 0),
    [counts],
  );

  // `integRagLabel` is three full passes over every integration, and each pass
  // calls isOverdue/isStale, which allocate two Dates apiece. Unmemoized it ran
  // on every render of this screen.
  const rag = useMemo(() => (client ? integRagLabel(client) : null), [client]);

  return (
    <div className="k-page">
      <QueryState
        isPending={query.isPending}
        isPaused={query.isPaused}
        error={query.error}
        onRetry={() => query.refetch()}
        skeletonRows={8}
      >
        {client && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="k-page-title truncate">{client.name}</h1>
                {/* 1c's meta row. The RAG pill belongs HERE, beside the facts
                    it summarises, rather than over in the action group where it
                    read as a fourth button.
                    1c also carries "SAP SuccessFactors · Go-live 14 Nov 2026"
                    in this row. There is no platform or go-live column on
                    `Client` — that is invented data in the mockup — so the
                    client's description takes the slot when there is one. */}
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-k-mute">
                  {client.masterAssignee && (
                    <span>
                      Master owner{" "}
                      <strong className="font-semibold text-k-ink">
                        {client.masterAssignee}
                      </strong>
                    </span>
                  )}
                  {client.description && (
                    <>
                      {client.masterAssignee && (
                        <span className="text-k-mute-2" aria-hidden>
                          |
                        </span>
                      )}
                      <span className="min-w-0 truncate">
                        {client.description}
                      </span>
                    </>
                  )}
                  {rag && <RagPill rag={rag} />}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* Before the canEdit gate on purpose: v1 showed the export
                    menu to every role on this screen, and a viewer being able
                    to produce the client report is the point of the role. */}
                <ExportMenu
                  items={[
                    {
                      label: "Integration Report (PDF)",
                      run: async () => {
                        const { exportIntegrationPdf } =
                          await import("@/lib/export/integration-pdf");
                        await exportIntegrationPdf(client);
                        toast.success("Report downloaded.");
                      },
                    },
                    ...(canEdit
                      ? [
                          {
                            label: "Email report to client…",
                            run: () => setEmailing(true),
                          },
                        ]
                      : []),
                    {
                      label: "Excel (Integrations)",
                      run: async () => {
                        const { exportClientExcel } =
                          await import("@/lib/export/excel");
                        await exportClientExcel("integrations", client);
                        toast.success("Spreadsheet downloaded.");
                      },
                    },
                    {
                      label: "Excel (Milestones)",
                      // Disabled rather than hidden: a client with no
                      // milestones would otherwise get a valid, empty file and
                      // wonder what went wrong.
                      disabledReason: (client.integrations ?? []).some(
                        (i) => (i.milestones ?? []).length > 0,
                      )
                        ? undefined
                        : "none yet",
                      run: async () => {
                        const { exportClientExcel } =
                          await import("@/lib/export/excel");
                        await exportClientExcel("milestones", client);
                        toast.success("Spreadsheet downloaded.");
                      },
                    },
                  ]}
                />
                {canEdit && (
                  <button
                    type="button"
                    className="k-btn k-btn-primary k-btn-sm"
                    onClick={() => setAdding(true)}
                  >
                    <Plus size={13} strokeWidth={1.5} aria-hidden />
                    Integration
                  </button>
                )}
              </div>
            </header>

            {emailing && (
              <ClientEmailDialog
                client={client}
                open
                onOpenChange={(o) => !o && setEmailing(false)}
              />
            )}

            {/* MOUNTED ONLY WHEN OPEN. Rendered unconditionally it still ran
                its own useAssigneeOptions — a second observer on the user
                query — plus a useCreateEntity mutation, on a screen where the
                dialog is shut the overwhelming majority of the time. The
                ClientEmailDialog above already guards itself this way. */}
            {adding && (
              <AddIntegrationDialog
                clientId={clientId}
                clientName={client.name}
                open={adding}
                onOpenChange={setAdding}
              />
            )}
            {/* Status filter chips. The counts came off the Status mix card,
                which this replaces — only statuses actually present are drawn,
                because a row of seven "(0)" chips wraps to two lines and says
                nothing the absent chip did not already say. */}
            {all.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Filter by status"
                >
                  <Chip
                    label="All"
                    count={all.length}
                    active={filter === "all"}
                    onClick={() => setFilter("all")}
                  />
                  {chipStatuses.map((status) => (
                    <Chip
                      key={status}
                      label={status}
                      count={counts[status] ?? 0}
                      active={filter === status}
                      onClick={() => setFilter(status)}
                    />
                  ))}
                </div>
              </div>
            )}

            {all.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No integrations yet"
                  hint="Integrations added for this client will appear here."
                />
              </div>
            ) : (
              /* THE LIST IS THE RAIL, the record is the main pane — the
                 opposite of the table version, and `railSide="start"` is how
                 SplitPane says so (it also moves the drag handle, so dragging
                 right still widens the list). Below a 720px container the two
                 stack, list above record, which is the only sensible order on
                 a phone. */
              <SplitPane
                pane="integList"
                railSide="start"
                label="Resize integration list"
                className="mt-4"
                rail={
                  <IntegrationList
                    rows={shown}
                    total={all.length}
                    sort={sort}
                    onSort={setSort}
                    selectedId={selectedId}
                    onSelect={pick}
                    filtered={filter !== "all"}
                  />
                }
                main={
                  selected ? (
                    <IntegrationPanel
                      clientId={clientId}
                      integration={selected}
                      // Clear the whole selection rather than marking it
                      // closed: the record is gone, so the next render should
                      // fall through to the first row that is still here.
                      onArchived={() => setSel(null)}
                    />
                  ) : (
                    <div className="k-card p-8">
                      <EmptyState
                        title="Nothing selected"
                        hint="Choose an integration on the left to see its record."
                      />
                    </div>
                  )
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
 * A status filter chip, now carrying its count.
 *
 * The count came off the Status mix card this replaced. It is the whole set at
 * a glance — which is what the card was for — without a second block of screen
 * repeating what the chips already name.
 *
 * The active look is tinted rather than the stylesheet's
 * `.k-chip[data-active="true"]`, which is a solid primary fill with white text.
 * 1c's chips are tinted, and a row of solid blue blocks would out-shout the
 * list they filter.
 */
function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`k-chip k-chip-sm ${
        active
          ? "border-k-primary bg-k-primary/[.08] font-semibold text-k-primary"
          : "text-k-ink-3"
      }`}
    >
      {label}
      <span className={`k-mono ml-1 ${active ? "" : "text-k-mute"}`}>
        ({count})
      </span>
    </button>
  );
}

/**
 * The integration list: a column of selectable cards.
 *
 * Replaces the six-column table. The fields that table carried are not lost —
 * Status, Assignee, Due, Milestones and Updated are all in the record panel
 * beside it, on the row they describe, rather than squeezed into a column each.
 *
 * The card geometry is the client rail's (`components/client-rail.tsx`), which
 * already solved the fidgety part: a `border-l-[3px]` that is TRANSPARENT at
 * rest rather than absent, so selecting a card shifts nothing sideways.
 *
 * Each card is a button, not a link. The record it selects opens beside it, and
 * the full page is one click away in that record — where the link is a real
 * anchor, so open-in-new-tab still exists in the one place anyone reaches for
 * it. A link here would have needed a nested button, or a row that navigates
 * away from the list it is part of.
 */
function IntegrationList({
  rows,
  total,
  sort,
  onSort,
  selectedId,
  onSelect,
  filtered,
}: {
  rows: Integration[];
  total: number;
  sort: IntegSort;
  onSort: (mode: IntegSort) => void;
  selectedId: string | null;
  onSelect: (integId: string) => void;
  filtered: boolean;
}) {
  return (
    <section className="k-card overflow-hidden" aria-label="Integrations">
      <div className="flex items-center justify-between gap-2 border-b border-k-line-2 px-3.5 py-3">
        <h2 className="k-eyebrow">
          <span className="k-mono text-[13px] text-k-ink">{total}</span>{" "}
          integration{total === 1 ? "" : "s"}
        </h2>
        <select
          className="k-select k-input-sm w-[124px]"
          aria-label="Sort integrations"
          value={sort}
          onChange={(e) => onSort(e.target.value as IntegSort)}
        >
          {INTEG_SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "Nothing with that status" : "No integrations yet"}
          hint={filtered ? "Clear the filter to see the rest." : undefined}
        />
      ) : (
        <ul>
          {rows.map((i) => (
            <IntegrationCard
              key={i.id}
              integration={i}
              selected={i.id === selectedId}
              onSelect={() => onSelect(i.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function IntegrationCard({
  integration: i,
  selected,
  onSelect,
}: {
  integration: Integration;
  selected: boolean;
  onSelect: () => void;
}) {
  const overdue = isOverdue(i);
  const reason = integRiskReason(i);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`block w-full border-b border-l-[3px] border-b-k-line-2 px-3.5 py-3 text-left transition-colors ${
          selected
            ? "border-l-k-primary bg-k-primary/[.05]"
            : "border-l-transparent hover:bg-k-surface"
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`min-w-0 truncate text-[13px] font-semibold ${
              selected ? "text-k-primary" : "text-k-ink"
            }`}
          >
            {i.name}
          </span>
          <span
            className={`k-mono shrink-0 text-[11px] ${
              overdue ? "font-semibold text-k-text-red" : "text-k-mute"
            }`}
          >
            {i.dueDate ? fmtDate(i.dueDate) : "—"}
          </span>
        </div>

        <p className="mt-0.5 truncate text-[11.5px] text-k-mute">
          {i.description || "—"}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusPill status={i.status} size="sm" />
          {/* The reference has no room for this and this tracker cannot do
              without it: worst-first ordering is meaningless if the reason a
              row is first is invisible. */}
          {reason && (
            <span className="flex items-center gap-1 text-[11px] text-k-text-red">
              <AlertTriangle size={11} strokeWidth={1.5} aria-hidden />
              {reason}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
