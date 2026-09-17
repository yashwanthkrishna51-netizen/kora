"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Plus } from "lucide-react";
import { useClient } from "@/lib/query/hooks";
import { QueryState, EmptyState } from "@/components/ui/states";
import { StatusPill, RagPill } from "@/components/ui/status";
import { ExportMenu } from "@/components/export-menu";
import { ResizeHandle, usePaneWidth } from "@/components/ui/resizable";
import {
  Checklist,
  SignoffNotice,
} from "@/components/implementation/phase-parts";
import { toast } from "sonner";
import { InlineSelect } from "@/components/ui/inline";
import { useCanEdit } from "@/lib/query/permissions";
import { AddModuleDialog } from "@/components/create/module-dialog";
import { ActivityFeed } from "@/components/activity-feed";
import {
  PHASES,
  SIGNOFF_PHASES,
  STATUSES,
  STATUS_CELL,
  shortPhase,
} from "@/lib/domain/constants";
import {
  implAutoRag,
  canCompletePhase,
  implSignoffCounts,
  projectedGoLive,
  moduleOwner,
  phaseSignedOff,
} from "@/lib/domain/implementation";
import { useUi } from "@/lib/store/ui";
import { fmtDate } from "@/lib/utils/dates";
import type { Client, Module, Phase, Status } from "@/lib/domain/types";
import { initials } from "@/lib/utils/people";

/**
 * CELL COLOUR COMES FROM `STATUS_CELL`, not from anything declared here.
 *
 * Two constants used to live at this spot, and before that they were raw
 * `rgba(...)` literals frozen at their light-mode values — which is why the
 * design test still watches this file for hex. `STATUS_CELL` in
 * lib/domain/constants.ts now carries a theme-aware token per status, so the
 * matrix cannot reintroduce that bug and cannot disagree with its own legend.
 */

/**
 * The implementation matrix (artboard 1e): modules down, the nine fixed phases
 * across, with a persistent 300px side panel.
 *
 * THE GRID IS `150px repeat(9, 1fr)` AND THE NINE COLUMNS ARE FIXED. Every
 * module has exactly nine phases — the API creates them together in one
 * transaction for precisely this reason — so the grid is indexed by phase NAME
 * rather than by whatever a module happens to contain. A module missing a row
 * renders as an empty cell in the right column instead of shifting all the
 * others left, which is what an `array.map` would do and what would make the
 * whole grid silently wrong.
 *
 * THE SIDE PANEL IS NEW IN THE RESKIN. The old app navigated away to a full
 * page for every cell, which meant losing the matrix to read one phase and
 * going back to compare. Selecting a cell here fills the panel and leaves the
 * grid in place; the full page still exists behind a link, for deep-linking and
 * for the activity feed at full width.
 */
export function ImplementationMatrixView({ clientId }: { clientId: string }) {
  const query = useClient(clientId);
  const client = query.data;
  const [selected, setSelected] = useState<{
    moduleId: string;
    phase: string;
  } | null>(null);
  const [addingModule, setAddingModule] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const panel = usePaneWidth("phasePanel");
  const canEditClient = useCanEdit();
  const rememberClient = useUi((s) => s.rememberClient);

  // Recorded on arrival rather than on a rail click, so a typed URL, a
  // bookmark and a link from the palette all count as "where I was".
  // `/implementation` with no client reopens this one.
  useEffect(() => {
    rememberClient("implementation", clientId);
  }, [clientId, rememberClient]);

  const modules = client?.modules ?? [];
  /**
   * ONE FRACTION IN THIS FILE, not two.
   *
   * `implProgress` was called here for its `total` alone, and it counts
   * Completed without the sign-off gate — so its `pct` and the percentage this
   * screen actually shows disagreed by design. `implSignoffCounts` returns the
   * identical total (both walk every phase of every module) and is the measure
   * the gate enforces, the stat cards state and the rail's ring draws.
   */
  const signoff = client ? implSignoffCounts(client) : null;
  const rag = client ? implAutoRag(client) : null;

  const selectedModule = modules.find((m) => m.id === selected?.moduleId);
  const selectedPhase = selectedModule?.phases?.find(
    (p) => p.name === selected?.phase,
  );

  return (
    <div className="k-matrix-frame flex h-full min-h-0">
      {/* The scroll container and the page measure are two different boxes
          here. Centring has to happen INSIDE the scroller — put `k-page` on
          the overflow element and the margins scroll away with the content. */}
      <div className="min-w-0 flex-1 overflow-auto">
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
                    {/* 1e's meta line. The phase COUNT has moved to the line
                      below, which states it with a numerator; repeating "81
                      phases" directly above "18/81 phases complete" said
                      nothing the second time. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-k-mute">
                      <span>
                        {modules.length} module{modules.length === 1 ? "" : "s"}
                        {client.masterAssignee && (
                          <>
                            {" "}
                            · PMO{" "}
                            <span className="font-semibold text-k-ink">
                              {client.masterAssignee}
                            </span>
                          </>
                        )}
                      </span>
                      {rag && <RagPill rag={rag} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ExportMenu
                      items={[
                        {
                          label: "Implementation Report (PDF)",
                          disabledReason: modules.length
                            ? undefined
                            : "no modules",
                          run: async () => {
                            const { exportImplementationPdf } =
                              await import("@/lib/export/implementation-pdf");
                            await exportImplementationPdf(client);
                            toast.success("Report downloaded.");
                          },
                        },
                        {
                          label: "Excel (Implementation)",
                          disabledReason: modules.length
                            ? undefined
                            : "no modules",
                          run: async () => {
                            const { exportClientExcel } =
                              await import("@/lib/export/excel");
                            await exportClientExcel("impl", client);
                            toast.success("Spreadsheet downloaded.");
                          },
                        },
                      ]}
                    />
                    {canEditClient && (
                      <button
                        type="button"
                        className="k-btn k-btn-primary k-btn-sm"
                        onClick={() => setAddingModule(true)}
                      >
                        <Plus size={13} strokeWidth={1.5} aria-hidden />
                        Module
                      </button>
                    )}
                  </div>
                </header>

                {/* HOW FAR ALONG THIS CLIENT IS, at the top of its own screen.

                    It was the first stat card, below the grid and after the
                    legend, which is a long way down for the one number anyone
                    asks for first. It is the same count the rail's ring draws
                    beside the client's name, so the two agree by construction
                    rather than by coincidence — and it counts signed-off
                    phases, the measure the gate enforces, not merely Completed
                    ones.

                    Suppressed for a client with no phases: "0/0 · 0%" under a
                    "No modules yet" empty state is noise about nothing. */}
                {signoff && signoff.total > 0 && (
                  <ProgressLine
                    signedOff={signoff.signedOff}
                    total={signoff.total}
                  />
                )}

                <AddModuleDialog
                  clientId={clientId}
                  clientName={client.name}
                  open={addingModule}
                  onOpenChange={setAddingModule}
                />

                {modules.length === 0 ? (
                  <div className="mt-5">
                    {/* The null-sentinel case: in the domain, nothing in it yet.
                      Six real clients are in exactly this state, and they are
                      the reason migration 0003 exists. */}
                    <EmptyState
                      title="No modules yet"
                      hint="This client is in the Implementation tracker but has no modules. Add one to start the nine-phase grid."
                    />
                  </div>
                ) : (
                  <Matrix
                    client={client}
                    modules={modules}
                    selected={selected}
                    onSelect={setSelected}
                  />
                )}
              </>
            )}
          </QueryState>
        </div>
      </div>

      {selected && selectedModule && (
        <>
          <div className="k-phase-panel">
            <ResizeHandle
              pane="phasePanel"
              edge="start"
              label="Resize phase panel"
              onLiveWidth={panel.setLive}
            />
          </div>
          <SidePanel
            clientId={clientId}
            module={selectedModule}
            phaseName={selected.phase}
            phase={selectedPhase}
            width={panel.width}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((v) => !v)}
            onClose={() => {
              setSelected(null);
              setExpanded(false);
            }}
          />
        </>
      )}
    </div>
  );
}

function Matrix({
  client,
  modules,
  selected,
  onSelect,
}: {
  client: Client;
  modules: Module[];
  selected: { moduleId: string; phase: string } | null;
  onSelect: (s: { moduleId: string; phase: string }) => void;
}) {
  const counts = implSignoffCounts(client);
  const goLive = projectedGoLive(client);

  return (
    <>
      <div className="mt-5 overflow-x-auto">
        <div className="k-card min-w-[900px] overflow-hidden">
          {/* Header row on --surface, per 1e. Names wrap rather than rotate and
              each carries its full name as a title for the ones that truncate. */}
          <div
            className="grid border-b border-k-line bg-k-surface"
            style={{ gridTemplateColumns: "150px repeat(9, 1fr)" }}
          >
            <div className="k-eyebrow px-3 py-2.5">Module</div>
            {PHASES.map((p) => (
              <div
                key={p}
                className="border-l border-k-line px-1 py-2.5 text-center text-[9.5px] font-semibold uppercase leading-[1.25] tracking-[.03em] text-k-mute"
                title={p}
              >
                {shortPhase(p)}
                {SIGNOFF_PHASES.includes(p) && (
                  <span
                    className="ml-0.5 text-k-text-amber"
                    title="Requires a signed document"
                  >
                    *
                  </span>
                )}
              </div>
            ))}
          </div>

          {modules.map((m) => {
            // Indexed by NAME, never by position — see the note above.
            const byName = new Map(
              (m.phases ?? []).map((p) => [p.name, p] as const),
            );
            const owner = moduleOwner(m);
            return (
              <div
                key={m.id}
                className="grid border-b border-k-line-2 last:border-b-0"
                style={{ gridTemplateColumns: "150px repeat(9, 1fr)" }}
              >
                <div className="min-w-0 px-3 py-2.5">
                  <p
                    className="truncate text-[12.5px] font-semibold text-k-ink"
                    title={m.name}
                  >
                    {m.name}
                  </p>
                  {/* 1e labels this "owner". `Module` has no owner column, so
                      this is the current phase's assignee and says so. */}
                  <p
                    className="truncate text-[10.5px] text-k-mute-2"
                    title={owner ? `On the live phase: ${owner}` : undefined}
                  >
                    {owner ?? "Unassigned"}
                  </p>
                </div>
                {PHASES.map((name) => {
                  const phase = byName.get(name);
                  const isSelected =
                    selected?.moduleId === m.id && selected?.phase === name;
                  return (
                    <Cell
                      key={name}
                      phase={phase}
                      label={`${m.name} — ${name}`}
                      selected={isSelected}
                      onClick={() => onSelect({ moduleId: m.id, phase: name })}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <Legend />

      {/* The asterisk needs saying out loud. It marks the three phases that
          cannot be completed without a signed document attached — a real
          constraint the server enforces, not decoration — and a marker whose
          only explanation is a hover title is a marker most people never
          read. */}
      <p className="mt-2 text-[11px] text-k-mute">
        <span className="text-k-text-amber">*</span> requires a signed document
        attached to an update before it can be completed
      </p>

      {/* TWO CARDS, NOT THREE. The first one said "22% — 18 of 81 phases
          signed off", which is now the progress line under the client's name
          at the top of the screen. Stating the same number twice, 600px apart,
          reads as two different measurements. */}
      <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
        <Stat
          value={counts.atRiskOrDelayed}
          label="phases at risk or delayed"
          tone={counts.atRiskOrDelayed > 0 ? "text-k-text-red" : undefined}
        />
        <Stat
          value={goLive ? fmtDate(goLive) : "—"}
          label="projected go-live"
          tone="text-k-text-amber"
          small
        />
      </div>
    </>
  );
}

/**
 * Every status, as a swatch.
 *
 * Ten entries, not five. The cells carry a colour per status now, so a legend
 * explaining four of them would leave most of the grid unexplained. Generated
 * from the same `STATUS_CELL` map the cells use, in `STATUSES` order — a legend
 * maintained by hand beside a grid is a legend that eventually lies.
 */
function Legend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-k-mute">
      {STATUSES.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-[11px] w-[11px] shrink-0 rounded-[2px]"
            style={{
              background: STATUS_CELL[status].fill,
              boxShadow:
                status === "Not Started"
                  ? "inset 0 0 0 1px var(--k-line)"
                  : undefined,
            }}
          />
          {status}
        </li>
      ))}
    </ul>
  );
}

/**
 * "18/81 phases complete · 22%", and the bar under it.
 *
 * LOCAL, like `StatusBar` in the rail and `WorkMix` in the AMS card. One
 * consumer, and no second caller in sight — a file in `components/ui` would be
 * a shared primitive that nothing shares.
 *
 * The bar is `aria-hidden`: the sentence above it is the same information in
 * words, and a decorative track announced after it helps nobody.
 */
function ProgressLine({
  signedOff,
  total,
}: {
  signedOff: number;
  total: number;
}) {
  const pct = total ? Math.round((signedOff / total) * 100) : 0;

  return (
    <div className="mt-3">
      <p className="text-[12.5px] text-k-mute">
        <span className="k-mono font-semibold text-k-ink">
          {signedOff}/{total}
        </span>{" "}
        phases complete · <span className="font-semibold">{pct}%</span>
      </p>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-k-line-2"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-k-ok transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  tone,
  small,
}: {
  value: React.ReactNode;
  label: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div className="k-card px-4 py-3.5">
      <p
        className={`k-num ${small ? "text-[18px]" : "text-[24px]"} ${tone ?? ""}`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[11px] text-k-mute">{label}</p>
    </div>
  );
}

/**
 * How a cell is painted. Null means "no row for this phase" — a data problem,
 * not a status, and drawn differently from Not Started so the two cannot be
 * confused.
 *
 * EVERY STATUS GETS ITS OWN COLOUR NOW. This used to collapse ten statuses into
 * five outcomes: anything that was not signed off, At Risk, Delayed or Not
 * Started came out as the same cyan dot, so On Hold, Pending Client, Under
 * Review, Cancelled and Completed-without-a-document were indistinguishable
 * across the grid. The point of a matrix is scanning it, and half the answers
 * were invisible.
 *
 * SIGNED OFF IS STILL NOT `status === "Completed"`. A sign-off phase completed
 * with no document attached is not signed off — `phaseSignedOff` asks the same
 * question the server asks before it will accept the write — so it is painted
 * as In Progress rather than given a green it has not earned.
 */
function cellPaint(
  phase: Phase | undefined,
): { fill: string; ink: string; who: string } | null {
  if (!phase) return null;

  const status: Status =
    phase.status === "Completed" && !phaseSignedOff(phase)
      ? "In Progress"
      : phase.status;

  const { fill, ink } = STATUS_CELL[status] ?? STATUS_CELL["Not Started"];
  return { fill, ink, who: phase.assignee ? initials(phase.assignee) : "" };
}

/**
 * One cell.
 *
 * A button, not a div: this is the primary way to move around the matrix, and
 * making it keyboard-reachable is the difference between a grid you can use and
 * a picture of one. The status is carried in the accessible name, along with
 * the assignee — the initials on screen are two letters and nothing else.
 */
function Cell({
  phase,
  label,
  selected,
  onClick,
}: {
  phase: Phase | undefined;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const status = (phase?.status ?? "Not Started") as Status;
  const paint = cellPaint(phase);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${phase ? status : "not present"}${
        phase?.assignee ? `, ${phase.assignee}` : ""
      }`}
      aria-pressed={selected}
      title={`${label} — ${phase ? status : "not present"}${
        phase?.assignee ? ` · ${phase.assignee}` : ""
      }`}
      className="flex min-h-9 w-full items-center justify-center border-l border-k-line p-1 transition-[filter] hover:brightness-95"
    >
      {/* The block sits INSIDE the button rather than being it, so the grid
          keeps its hairlines and the selected ring has something to hug. */}
      <span
        className="flex h-full min-h-7 w-full items-center justify-center rounded-[3px] text-[12px] font-bold leading-none"
        style={{
          background: paint ? paint.fill : undefined,
          color: paint?.ink,
          // A missing phase is a data problem, not a status. It reads as a
          // hairline outline so it cannot be mistaken for Not Started.
          boxShadow: paint ? undefined : "inset 0 0 0 1px var(--k-line-2)",
          outline: selected ? "2px solid var(--k-primary)" : undefined,
          outlineOffset: selected ? "1px" : undefined,
        }}
      >
        <span aria-hidden>{paint?.who}</span>
      </span>
    </button>
  );
}

/**
 * The persistent phase panel (artboard 1e).
 *
 * `xl` rather than `lg`: this app keeps its 268px client rail on the
 * Implementation screen, which the artboard does not draw. Sidebar + rail +
 * panel is 800px of chrome, so below 1280px the nine-column grid would be
 * squeezed under 40px a cell. Under that width the panel is absent and the
 * "Open phase" route is how you read a phase — the same fallback the rail
 * itself uses below 768px.
 */
function SidePanel({
  clientId,
  module,
  phaseName,
  phase,
  width,
  expanded,
  onToggleExpanded,
  onClose,
}: {
  clientId: string;
  module: Module;
  phaseName: string;
  phase: Phase | undefined;
  width: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
}) {
  // The gate is evaluated for display, exactly as the server evaluates it for
  // enforcement — one definition, so the panel can never promise something the
  // API would refuse.
  const gate = phase ? canCompletePhase(phase) : null;
  const canEdit = useCanEdit();
  const [logging, setLogging] = useState(false);
  const phaseTarget = phase
    ? {
        kind: "phase" as const,
        clientId,
        id: phase.id,
        path: `/api/phases/${encodeURIComponent(phase.id)}`,
        screen: "implementation",
      }
    : undefined;

  const owner = moduleOwner(module);
  const latest = phase?.updates?.[0];

  return (
    <aside
      className="k-phase-panel shrink-0 overflow-y-auto border-l border-k-line bg-k-paper p-5"
      // Expanded, the panel needs room for the checklist and the gate callout,
      // so it takes a floor of its own rather than the dragged width. Drag
      // still wins above that floor.
      style={{ width: expanded ? Math.max(width, 460) : width }}
      aria-label="Phase detail"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="k-eyebrow">Selected phase</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close phase detail"
          className="k-btn k-btn-ghost k-btn-sm !px-1.5"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* The FULL name here — the shortening exists only because a 1/9th grid
          column cannot hold it, and this column is 300px. */}
      <h2 className="mt-2 text-[18px] font-bold leading-tight text-k-primary">
        {phaseName}
      </h2>
      <p className="mt-1 text-[12px] text-k-mute">
        {module.name}
        {owner && <> · {owner}</>}
      </p>

      {!phase ? (
        <p className="mt-4 text-[12px] text-k-mute">
          This module has no row for this phase.
        </p>
      ) : (
        <>
          <div className="mt-3">
            {canEdit ? (
              <InlineSelect
                target={phaseTarget!}
                field="status"
                label={`Status for ${phaseName}`}
                value={phase.status}
                options={STATUSES}
                version={phase._v}
                before={phase}
                // THE SIGNOFF GATE, shown before it is hit rather than after.
                // v1 offered Completed freely and answered with a red toast
                // that vanished in 3.5 seconds — after it had already written
                // the form's other values into local state and not reverted
                // them, so the user's typed dates were silently stranded.
                //
                // 1e draws a static pill here. It stays a select for editors:
                // this is where the gate surfaces, and changing a status
                // without losing the grid is what the panel is for. Viewers get
                // the pill the artboard draws.
                optionDisabled={(o) => o === "Completed" && !!gate && !gate.ok}
                hint={gate && !gate.ok ? gate.reason : undefined}
              />
            ) : (
              <StatusPill status={phase.status} />
            )}
          </div>

          {/* 1e's read-only list. The four inline editors that used to live
              here (start date, current activity, next action, assignee) are all
              on the full phase page, one click away. 1e also lists "Open
              defects"; there is no defect model anywhere in the schema, so that
              row is dropped rather than shown permanently empty. */}
          <dl className="mt-4">
            <PanelField label="Owner">
              {phase.assignee || <span className="text-k-mute">—</span>}
            </PanelField>
            <PanelField label="Target date">
              {phase.targetDate ? (
                <span className="k-mono text-[11.5px]">
                  {fmtDate(phase.targetDate)}
                </span>
              ) : (
                <span className="text-k-mute">—</span>
              )}
            </PanelField>
            <PanelField label="Signed off">
              {phaseSignedOff(phase) ? (
                <span className="text-k-text-green">Yes</span>
              ) : (
                <span className="text-k-mute">No</span>
              )}
            </PanelField>
          </dl>

          <h3 className="k-eyebrow mt-5">Latest update</h3>
          {latest ? (
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-[1.6] text-k-ink-3">
              {latest.update}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-k-mute">
              No progress notes on this phase.
            </p>
          )}

          {/* OPEN PHASE NO LONGER NAVIGATES AWAY. It used to push the full
              phase route, which threw away the grid you were comparing against
              — the one thing the matrix is for. It now widens this pane and
              renders the phase's own checklist and gate in place, from the
              SAME components the phase page uses, so the two cannot drift.
              The route survives untouched behind "Full page", because it is a
              deep link and the catch-all that copes with the phase name
              containing a slash. */}
          {expanded && (
            <div className="mt-5 space-y-4 border-t border-k-line-2 pt-4">
              <div>
                <h3 className="k-eyebrow">Sign-off checklist</h3>
                <Checklist phase={phase} />
              </div>
              <SignoffNotice phase={phase} />
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onToggleExpanded}
              className="k-btn k-btn-primary k-btn-sm flex-1 justify-center"
            >
              {expanded ? "Show less" : "Open phase"}
            </button>
            {canEdit && !logging && (
              <button
                type="button"
                className="k-btn k-btn-outline k-btn-sm"
                onClick={() => setLogging(true)}
              >
                Log update
              </button>
            )}
            <Link
              href={`/implementation/${clientId}/${module.id}/${encodeURIComponent(phaseName)}`}
              title="Open the phase on its own page"
              className="k-btn k-btn-outline k-btn-sm"
            >
              Full page
            </Link>
          </div>

          {/* Supplying all three parents is what makes the feed writable, so
              the composer only exists once "Log update" has been pressed. */}
          {logging && (
            <div className="mt-4">
              <ActivityFeed
                entries={phase.updates ?? []}
                variant="compact"
                limit={3}
                emptyHint="No progress notes on this phase."
                parentKind="phase"
                parentId={phase.id}
                clientId={clientId}
              />
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function PanelField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-k-line-2 py-2.5 last:border-b-0">
      <dt className="text-[11.5px] text-k-mute">{label}</dt>
      <dd className="min-w-0 truncate text-[12px] font-semibold text-k-ink">
        {children}
      </dd>
    </div>
  );
}
