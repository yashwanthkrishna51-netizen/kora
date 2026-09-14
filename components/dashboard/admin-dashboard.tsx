"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUp, ArrowDown, Minus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useClientTrees, useSnapshots, useCapacityWeights } from "@/lib/query/hooks";
import { QueryState, EmptyState } from "@/components/ui/states";
import { RagDot } from "@/components/ui/status";
import { ExportMenu } from "@/components/export-menu";
import { useSession } from "@/lib/query/permissions";
import { Kpi, KpiStrip } from "./kpi";
import { CriticalItems, criticalDomainOf } from "./critical-items";
import {
  buildCriticalItems,
  healthRows,
  portfolioScore,
  upcomingDeadlines,
  hygieneScore,
  severityDistribution,
  blockers,
  teamBandwidth,
  updatesInWindow,
  allIntegrations,
  openAmsEntries,
  type CapacityRow,
  type CapacityWeights,
  type Deadline,
  type HealthRow,
  type Trend,
} from "@/lib/domain/dashboard";

/**
 * The admin dashboard (artboard 1b): the six-up KPI strip over the portfolio
 * tiles, worst-first throughout.
 *
 * EVERY NUMBER HERE COMES FROM `lib/domain/dashboard.ts`. That matters more
 * than it sounds. In the old app all of this was computed INLINE inside
 * dashboard.js's render function, which is why none of it was testable and why
 * `phaseFunnel` was able to drift from the original for months without anyone
 * noticing — it counted six statuses the original did not. The port made each
 * aggregation a named pure function and the golden suite now diffs all of them
 * against a transcription of the original. A tile that computed its own number
 * here would step straight back outside that net.
 */
export function AdminDashboard() {
  const trees = useClientTrees();
  const snaps = useSnapshots();
  const weights = useCapacityWeights();
  const session = useSession();

  const clients = useMemo(() => trees.data ?? [], [trees.data]);
  const [critFilter, setCritFilter] = useState<CritFilter>("All");

  const view = useMemo(() => {
    if (!clients.length) return null;
    const rows = healthRows(clients, snaps.data ?? []);
    return {
      rows,
      score: portfolioScore(rows),
      critical: buildCriticalItems(clients),
      deadlines: upcomingDeadlines(clients, 14),
      hygiene: hygieneScore(clients),
      severity: severityDistribution(clients),
      blocked: blockers(clients),
      bandwidth: teamBandwidth(clients, weights),
      updates7: updatesInWindow(clients, 7),
      integrations: allIntegrations(clients),
      openAms: openAmsEntries(clients),
    };
  }, [clients, snaps.data, weights]);

  // Counts describe the WHOLE set, not the filtered one — the same rule the
  // integrations chips follow. A chip that recounted itself after you clicked
  // it could only ever read "n of n".
  const critCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const item of view?.critical ?? []) {
      const d = criticalDomainOf(item);
      c[d] = (c[d] ?? 0) + 1;
    }
    return c;
  }, [view]);

  const critShown = useMemo(
    () =>
      critFilter === "All"
        ? (view?.critical ?? [])
        : (view?.critical ?? []).filter((i) => criticalDomainOf(i) === critFilter),
    [view, critFilter],
  );

  const red = view?.rows.filter((r) => r.overall === "Red").length ?? 0;
  const amber = view?.rows.filter((r) => r.overall === "Amber").length ?? 0;

  return (
    <div className="k-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Datestamp />
          <h1 className="font-k-head text-[26px] font-bold leading-tight text-k-primary">
            Portfolio
          </h1>
          <p className="mt-1 text-[13px] text-k-mute">
            {view
              ? `${view.rows.length} client${view.rows.length === 1 ? "" : "s"} across three delivery streams — sorted worst-first`
              : "Every client, across all three trackers."}
          </p>
        </div>
        {/* 1b pairs this with a "Customize" button. There is no
            dashboard-customisation feature anywhere in the app, and a control
            that does nothing is worse than an absent one, so it is omitted. */}
        {clients.length > 0 && (
          <ExportMenu
            label="Portfolio Export"
            tone="primary"
            size="md"
            items={(["integrations", "impl", "ams"] as const).map((d) => ({
              label: `Excel (${d === "impl" ? "Implementation" : d === "ams" ? "AMS" : "Integrations"})`,
              run: async () => {
                // The trees are already in hand here — unlike the admin
                // Clients tab, which has to fetch them on click.
                const { exportAdminTableExcel } = await import("@/lib/export/excel");
                await exportAdminTableExcel(d, clients);
                toast.success("Spreadsheet downloaded.");
              },
            }))}
          />
        )}
      </header>

      <div className="mt-5">
        <QueryState
          isPending={trees.isPending}
          isPaused={trees.isPaused}
          error={trees.error}
          onRetry={() => trees.refetch()}
          isEmpty={!view}
          skeletonRows={10}
          empty={<EmptyState title="No clients yet" />}
        >
          {view && (
            <>
              {/* THE STRIP STAYS PUT (1b's own title). The document is what
                  scrolls — nothing in the shell is a scroll container — so
                  `sticky` needs no structural change. `-mx-7 px-7` widens the
                  band across the page's padding so cards do not slide past it
                  through the gutters, and `--k-surface` is the page ground.
                  z-40 keeps it UNDER `.k-banner-rail` (z-60): an offline or
                  view-as banner outranks six numbers. No `top` offset for the
                  rail's height on purpose — it is sticky rather than fixed
                  precisely so nobody has to maintain that number. */}
              <div className="sticky top-0 z-40 -mx-7 -mt-3 bg-k-surface px-7 pb-3.5 pt-3">
                <KpiStrip>
                  <Kpi
                    label="Clients"
                    value={view.rows.length}
                    accent="var(--k-primary)"
                    sub="in the portfolio"
                  />
                  <Kpi
                    label="Clients off track"
                    value={red + amber}
                    accent="var(--k-fill-warn)"
                    sub={`${red} red · ${amber} amber`}
                  />
                  <Kpi
                    label="Needs attention"
                    value={view.critical.length}
                    accent="var(--k-fill-risk)"
                    sub={`${view.critical.filter((c) => c.severity === 0).length} highest`}
                  />
                  <Kpi
                    label="Integrations"
                    value={view.integrations.length}
                    accent="var(--k-cyan)"
                    sub={`${view.integrations.filter((i) => i.status === "Completed").length} complete`}
                    href="/integrations"
                  />
                  <Kpi
                    label="Open AMS"
                    value={view.openAms.length}
                    accent="var(--k-olive)"
                    // Deliberately "of N logged" rather than a critical count.
                    // `severityDistribution` spans EVERY entry, open and closed,
                    // so pairing its L4 figure with an open-only headline would
                    // put two different populations in one card — which is how
                    // this card read until the two numbers were compared.
                    sub={`of ${view.severity.total} logged`}
                    href="/ams"
                  />
                  <Kpi
                    label="Updates, 7 days"
                    value={view.updates7}
                    accent="var(--k-sky)"
                    sub={`hygiene ${view.hygiene.score}%`}
                  />
                </KpiStrip>
              </div>

              {/* ------------------------------------ critical items, full width */}
              <section className="k-card mt-4">
                <div className="k-card-head flex-wrap gap-y-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: "var(--k-fill-risk)" }}
                    />
                    <h2 className="k-card-title">Critical items — start here</h2>
                  </div>
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label="Filter critical items by domain"
                  >
                    <Chip
                      label={`All ${view.critical.length}`}
                      active={critFilter === "All"}
                      onClick={() => setCritFilter("All")}
                    />
                    {CRIT_DOMAINS.filter((d) => (critCounts[d] ?? 0) > 0).map((d) => (
                      <Chip
                        key={d}
                        label={d}
                        active={critFilter === d}
                        onClick={() => setCritFilter(d)}
                      />
                    ))}
                  </div>
                </div>
                <CriticalItems
                  items={critShown}
                  variant="table"
                  limit={10}
                  emptyTitle={
                    critFilter === "All"
                      ? "Nothing is overdue, stale or critical"
                      : `Nothing critical in ${critFilter}`
                  }
                  emptyHint={
                    critFilter === "All"
                      ? "Every integration, phase and ticket is inside its thresholds."
                      : undefined
                  }
                />
              </section>

              {/* ------------------------------- scorecard + deadlines, 2-up */}
              <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
                <Scorecard rows={view.rows} score={view.score} />
                <Deadlines deadlines={view.deadlines} />
              </div>

              {/* ------------------------------- team bandwidth, full width */}
              <Bandwidth
                bandwidth={view.bandwidth}
                weights={weights}
                isAdmin={session?.role === "admin"}
              />

              {/* ------------------------------------------ 1b draws no more */}
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <section className="k-card p-4">
                  <h2 className="k-card-title">Hygiene</h2>
                  <p className="mt-2">
                    <span className="k-num text-[28px] leading-none">
                      {view.hygiene.score}%
                    </span>
                  </p>
                  <dl className="mt-3 space-y-1.5 text-[12px]">
                    <HygieneRow label="Have an assignee" v={view.hygiene.assignee} />
                    <HygieneRow label="Have a due date" v={view.hygiene.due} />
                    <HygieneRow label="Updated recently" v={view.hygiene.fresh} />
                  </dl>
                </section>

                <section className="k-card p-4">
                  {/* "AMS by severity", not "OPEN AMS by severity". The counts
                      span every entry ever logged; only the age line below is
                      restricted to open tickets. Saying "open" over a total of
                      61 while the KPI card says 37 open is the kind of quiet
                      contradiction that makes people stop trusting a
                      dashboard. */}
                  <div className="k-card-head !border-b-0 !px-0 !pt-0">
                    <h2 className="k-card-title">AMS by severity</h2>
                    <span className="k-mono text-[11px] text-k-mute">
                      {view.severity.total}
                    </span>
                  </div>
                  {view.severity.total === 0 ? (
                    <p className="mt-3 text-[12px] text-k-mute">Nothing logged.</p>
                  ) : (
                    <>
                      <ul className="mt-3 space-y-1.5 text-[12px]">
                        {Object.entries(view.severity.counts)
                          .filter(([, n]) => n > 0)
                          .map(([level, n]) => (
                            <li
                              key={level}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="text-k-ink-3">{level}</span>
                              <span className="k-mono text-k-mute">{n}</span>
                            </li>
                          ))}
                      </ul>
                      <p className="mt-2 border-t border-k-line-2 pt-2 text-[11px] text-k-mute">
                        All entries, open and closed. {view.openAms.length} are
                        still open.
                      </p>
                      {view.severity.oldestCriticalDays !== null && (
                        <p className="mt-1 text-[11.5px] font-semibold text-k-text-red">
                          Oldest OPEN L3/L4 ticket:{" "}
                          {view.severity.oldestCriticalDays} days
                        </p>
                      )}
                    </>
                  )}
                </section>

                <section className="k-card p-4">
                  <div className="k-card-head !border-b-0 !px-0 !pt-0">
                    <h2 className="k-card-title">Blockers</h2>
                    <span className="k-mono text-[11px] text-k-mute">
                      {view.blocked.length}
                    </span>
                  </div>
                  <div className="mt-3">
                    {view.blocked.length === 0 ? (
                      <EmptyState title="Nothing is blocked" icon={Sparkles} />
                    ) : (
                      <ul className="space-y-2">
                        {view.blocked.slice(0, 6).map((b, i) => (
                          <li key={`${b.client}-${i}`}>
                            <p className="text-[12px] text-k-ink">{b.text}</p>
                            <p className="text-[11px] text-k-mute">{b.client}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </QueryState>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header */

/**
 * 1b's datestamp line.
 *
 * RENDERED AFTER MOUNT, never on the server. The server's clock and timezone
 * are not the reader's, so a server-rendered timestamp is a guaranteed
 * hydration mismatch — and this is a `force-dynamic` route, so it really would
 * render server-side. The placeholder holds the line's height so the heading
 * below it does not jump when the clock arrives.
 */
function Datestamp() {
  const [stamp, setStamp] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setStamp(formatStamp(new Date()));
    tick();
    // A clock that stops is worse than no clock; a minute is as precise as the
    // line claims to be.
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <p className="k-mono mb-1.5 h-[14px] text-[10.5px] uppercase tracking-[.06em] text-k-mute-2">
      {stamp}
    </p>
  );
}

function formatStamp(d: Date): string {
  const date = d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const zone =
    new Intl.DateTimeFormat("en-IN", { timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  // en-IN punctuates as "Tue, 08 Sept, 2026" — both commas go, not just the
  // first one, or the line reads "TUE 08 SEPT, 2026".
  return `${date.replace(/,/g, "")} · ${time} ${zone}`.trim().toUpperCase();
}

/* --------------------------------------------------------- critical filter */

type CritFilter = "All" | "Integration" | "Phase" | "AMS";
const CRIT_DOMAINS = ["Integration", "Phase", "AMS"] as const;

/** Tinted rather than the stylesheet's solid active chip — see the 1c note. */
function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
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
    </button>
  );
}

/* --------------------------------------------------------------- scorecard */

function Scorecard({ rows, score }: { rows: HealthRow[]; score: number }) {
  return (
    <section className="k-card">
      <div className="k-card-head">
        <h2 className="k-card-title">Portfolio health scorecard</h2>
        {/* 1b puts the score HERE, beside the dots it summarises, rather than
            in the KPI strip where it used to sit. One number, one place. */}
        <div className="text-right">
          <p
            className="k-num text-[20px] leading-none"
            style={{ color: scoreTone(score) }}
          >
            {score}
          </p>
          <p className="mt-0.5 text-[9.5px] text-k-mute-2">portfolio score</p>
        </div>
      </div>

      <div className="k-thead-plain grid grid-cols-[1fr_34px_34px_34px_76px]">
        <div>Client</div>
        <div className="text-center">Int</div>
        <div className="text-center">Impl</div>
        <div className="text-center">AMS</div>
        <div className="text-right">Trend</div>
      </div>

      {/* Already worst-first: healthRows sorts on the overall RAG, which is
          why 1b needs no Overall column of its own. */}
      <ul>
        {rows.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-[1fr_34px_34px_34px_76px] items-center border-b border-k-line-2 px-[18px] py-2 text-[12.5px] last:border-b-0"
          >
            <Link
              href={`/integrations/${r.id}`}
              className="min-w-0 truncate font-medium text-k-ink hover:text-k-primary hover:underline"
            >
              {r.name}
            </Link>
            <div className="text-center">
              {r.integR ? <RagDot rag={r.integR} size={9} /> : <Dash />}
            </div>
            <div className="text-center">
              {r.implR ? <RagDot rag={r.implR} size={9} /> : <Dash />}
            </div>
            <div className="text-center">
              {r.amsR ? <RagDot rag={r.amsR} size={9} /> : <Dash />}
            </div>
            <div className="text-right">
              <TrendMark trend={r.trend} />
            </div>
          </li>
        ))}
      </ul>

      <p className="px-[18px] py-2.5 text-[11px] text-k-mute-2">
        100 per Green client + 50 per Amber, averaged.
      </p>
    </section>
  );
}

/* --------------------------------------------------------------- deadlines */

const TAG_TONE: Record<string, { bg: string; fg: string }> = {
  Milestone: { bg: "var(--k-tint-teal)", fg: "var(--k-text-teal)" },
  Phase: { bg: "var(--k-primary-10)", fg: "var(--k-primary)" },
  AMS: { bg: "var(--k-tint-warn)", fg: "var(--k-text-amber)" },
};

/** Day and month only — the year is implied by a 14-day window. */
function fmtDayMonth(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}

function Deadlines({ deadlines }: { deadlines: Deadline[] }) {
  return (
    <section className="k-card">
      <div className="k-card-head">
        <h2 className="k-card-title">Upcoming deadlines — next 14 days</h2>
        <span className="k-mono text-[11px] text-k-mute">{deadlines.length}</span>
      </div>
      {deadlines.length === 0 ? (
        <div className="p-4">
          <EmptyState title="Nothing due in the next fortnight" />
        </div>
      ) : (
        <ul>
          {deadlines.slice(0, 8).map((d, i) => (
            <li
              key={`${d.date}-${d.title}-${i}`}
              className="grid grid-cols-[64px_1fr] items-center gap-x-3 border-b border-k-line-2 px-[18px] py-2 text-[12.5px] last:border-b-0 sm:grid-cols-[64px_1fr_130px_82px]"
            >
              <span className="k-mono text-[11px] font-medium text-k-primary">
                {fmtDayMonth(d.date)}
              </span>
              <span className="min-w-0 truncate text-k-ink">{d.title}</span>
              <span className="hidden min-w-0 truncate text-k-mute sm:block">
                {d.client}
              </span>
              <span className="hidden sm:block">
                <span
                  className="k-status !px-2 !py-[2px] !text-[10px]"
                  style={{
                    background: TAG_TONE[d.tag]?.bg,
                    color: TAG_TONE[d.tag]?.fg,
                  }}
                >
                  {d.tag}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- bandwidth */

function Bandwidth({
  bandwidth,
  weights,
  isAdmin,
}: {
  bandwidth: { rows: CapacityRow[]; overCap: CapacityRow[] };
  weights: CapacityWeights;
  isAdmin: boolean;
}) {
  const over = bandwidth.overCap;

  return (
    <section className="k-card mt-4">
      <div className="k-card-head items-start">
        <div className="min-w-0">
          <h2 className="k-card-title">Team bandwidth</h2>
          {/* The live weights, not the handoff's example numbers — they are
              editable, and a caption that lies about the arithmetic is worse
              than none. */}
          <p className="mt-1 text-[11px] text-k-mute-2">
            Module = {weights.module} · PMO = {weights.pmo} · AMS ticket ={" "}
            {weights.ams} · Cap = {weights.cap}
          </p>
        </div>
        {isAdmin && (
          <Link href="/admin" className="k-btn k-btn-outline k-btn-sm shrink-0">
            Configure weights
          </Link>
        )}
      </div>

      {over.length > 0 && (
        <div
          className="flex items-center gap-2.5 border-b border-k-line-2 px-[18px] py-3.5"
          style={{ background: "rgba(239, 68, 68, .05)" }}
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: "var(--k-fill-risk)" }}
          />
          <p className="text-[12px] font-semibold text-k-text-red">
            Delivery risk: {over.length}{" "}
            {over.length === 1 ? "person is" : "people are"} over capacity right
            now — {over.map((r) => r.name).join(", ")}
          </p>
        </div>
      )}

      {bandwidth.rows.length === 0 ? (
        <div className="p-4">
          <EmptyState title="Nothing is assigned" />
        </div>
      ) : (
        <ul>
          {bandwidth.rows.slice(0, 10).map((r) => {
            const cap = Math.max(1, weights.cap);
            const pct = Math.min(100, (r.total / cap) * 100);
            const overCap = r.total > weights.cap;
            return (
              <li
                key={r.name}
                className="grid grid-cols-[110px_1fr_86px] items-center gap-3 border-b border-k-line-2 px-[18px] py-2.5 text-[12.5px] last:border-b-0 sm:grid-cols-[150px_1fr_86px]"
              >
                <span
                  className={`min-w-0 truncate font-medium ${
                    overCap ? "text-k-text-red" : "text-k-ink"
                  }`}
                >
                  {r.name}
                </span>
                <span
                  className="block h-2 overflow-hidden rounded-full"
                  style={{ background: "var(--k-line-2)" }}
                >
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${pct}%`, background: loadFill(r.total, weights) }}
                  />
                </span>
                <span
                  className={`k-mono text-right text-[11.5px] font-medium ${
                    overCap ? "text-k-text-red" : "text-k-mute"
                  }`}
                >
                  {Math.round(r.total * 100) / 100} / {weights.cap}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The load bar's fill.
 *
 * The 0.6 and 0.9 thresholds are `teamBandwidth`'s own — they are what it uses
 * to build `available` and `stretched` (lib/domain/dashboard.ts:500) — so the
 * colour of a bar and the bucket the domain function puts that person in can
 * never disagree.
 */
function loadFill(total: number, w: CapacityWeights): string {
  if (total > w.cap) return "var(--k-fill-risk)";
  if (total >= w.cap * 0.9) return "var(--k-fill-warn)";
  if (total < w.cap * 0.6) return "var(--k-fill-ok)";
  return "var(--k-teal)";
}

/* ------------------------------------------------------------------ bits */

/**
 * The trend arrow.
 *
 * Up is better, and here that is the literal truth rather than a convention:
 * `rankRag` scores Red 0, Amber 1, Green 2, and the trend is newest minus
 * oldest, so a positive difference is a client that has got greener.
 *
 * WORTH KNOWING because the LIVE APP DRAWS THIS BACKWARDS — it subtracts the
 * other way round, on the one tile whose whole purpose is showing which clients
 * are deteriorating. The port deliberately breaks with it and the golden suite
 * pins both directions, so anyone comparing the two screens side by side during
 * cutover will find they disagree. That is intended.
 *
 * The word is rendered next to the arrow because a direction alone is a
 * convention the reader has to already share.
 */
function TrendMark({ trend }: { trend: Trend }) {
  if (trend === "new") {
    return <span className="text-[11px] text-k-mute-2">new</span>;
  }
  if (trend === "same") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-k-mute">
        <Minus size={11} strokeWidth={1.5} aria-hidden />
        <span className="sr-only">unchanged</span>
      </span>
    );
  }
  const better = trend === "better";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
        better ? "text-k-text-green" : "text-k-text-red"
      }`}
      title={better ? "Improving" : "Worsening"}
    >
      {better ? (
        <ArrowUp size={11} strokeWidth={1.5} aria-hidden />
      ) : (
        <ArrowDown size={11} strokeWidth={1.5} aria-hidden />
      )}
      {better ? "better" : "worse"}
    </span>
  );
}

function Dash() {
  return <span className="text-k-mute-2">—</span>;
}

function HygieneRow({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-k-ink-3">{label}</dt>
      <dd className="k-mono text-k-mute">{Math.round(v * 100)}%</dd>
    </div>
  );
}

function scoreTone(score: number): string {
  if (score >= 70) return "var(--k-text-green)";
  if (score >= 40) return "var(--k-text-amber)";
  return "var(--k-text-red)";
}
