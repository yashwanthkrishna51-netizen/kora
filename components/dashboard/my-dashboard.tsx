"use client";

import { useMemo } from "react";
import { useClientTrees } from "@/lib/query/hooks";
import { QueryState, EmptyState } from "@/components/ui/states";
import { Kpi, KpiStrip } from "./kpi";
import { CriticalItems } from "./critical-items";
import { fmtDate } from "@/lib/utils/dates";
import {
  buildCriticalItems,
  upcomingDeadlines,
  allIntegrations,
} from "@/lib/domain/dashboard";

/**
 * The editor/viewer dashboard (artboard 1l).
 *
 * A DIFFERENT SCREEN, not the admin one with tiles hidden. The plan is explicit
 * about this and it is the right call: an editor does not need a portfolio
 * score, a hygiene percentage or a team-load chart — those are questions a
 * delivery manager asks. What an editor needs is "what is on my plate", which
 * the admin dashboard does not answer at all.
 *
 * MATCHING IS BY DISPLAY NAME, which is fragile and unavoidable. Assignee
 * fields hold typed names rather than user ids — the same fragile key the daily
 * digest routes on. The consequence is visible rather than hidden: when nothing
 * matches, the empty state says the name it looked for, so a mismatch reads as
 * a data problem instead of as "you have nothing to do".
 */
export function MyDashboard({ name }: { name: string }) {
  const trees = useClientTrees();
  const clients = useMemo(() => trees.data ?? [], [trees.data]);

  const view = useMemo(() => {
    if (!clients.length) return null;

    const mine = (owner: string | undefined) =>
      (owner ?? "").trim().toLowerCase() === name.trim().toLowerCase();

    const critical = buildCriticalItems(clients).filter((i) => mine(i.owner));

    const myIntegrations = allIntegrations(clients).filter((i) =>
      mine(i.assignee),
    );

    // Deadlines have no owner field, so they are narrowed to the clients the
    // person appears on rather than to the item itself. Stated in the heading,
    // because a list labelled "mine" that is really "my clients'" would be a
    // quiet lie.
    const myClientNames = new Set(
      clients
        .filter(
          (c) =>
            mine(c.masterAssignee) ||
            (c.integrations ?? []).some((i) => mine(i.assignee)) ||
            (c.modules ?? []).some((m) =>
              (m.phases ?? []).some((p) => mine(p.assignee)),
            ),
        )
        .map((c) => c.name),
    );
    const deadlines = upcomingDeadlines(clients, 14).filter((d) =>
      myClientNames.has(d.client),
    );

    return {
      critical,
      myIntegrations,
      deadlines,
      openCount: myIntegrations.filter((i) => i.status !== "Completed").length,
      clientCount: myClientNames.size,
    };
  }, [clients, name]);

  return (
    <div className="k-page">
      <header>
        <h1 className="k-page-title">Your week</h1>
        <p className="mt-1 text-[12.5px] text-k-mute">
          Everything assigned to {name}.
        </p>
      </header>

      <div className="mt-5">
        <QueryState
          isPending={trees.isPending}
          isPaused={trees.isPaused}
          error={trees.error}
          onRetry={() => trees.refetch()}
          isEmpty={!view}
          skeletonRows={8}
          empty={<EmptyState title="No clients yet" />}
        >
          {view && (
            <>
              <KpiStrip>
                <Kpi
                  label="Needs attention"
                  value={view.critical.length}
                  accent="var(--k-fill-risk)"
                  sub={`${view.critical.filter((c) => c.severity === 0).length} highest`}
                  size={26}
                />
                <Kpi
                  label="Your integrations"
                  value={view.myIntegrations.length}
                  accent="var(--k-cyan)"
                  sub={`${view.openCount} still open`}
                  size={26}
                />
                <Kpi
                  label="Due in 14 days"
                  value={view.deadlines.length}
                  accent="var(--k-olive)"
                  sub="across your clients"
                  size={26}
                />
                <Kpi
                  label="Your clients"
                  value={view.clientCount}
                  accent="var(--k-primary)"
                  size={26}
                />
              </KpiStrip>

              <div className="mt-5 grid gap-5 lg:grid-cols-3">
                <section className="k-card p-4 lg:col-span-2">
                  <div className="k-card-head">
                    <h2 className="k-card-title">Your critical items</h2>
                    <span className="k-mono text-[11px] text-k-mute">
                      {view.critical.length}
                    </span>
                  </div>
                  <div className="mt-3">
                    <CriticalItems
                      items={view.critical}
                      limit={10}
                      emptyTitle="Nothing of yours needs attention"
                      emptyHint={`Nothing assigned to "${name}" is overdue, stale or critical. If that looks wrong, the assignee on those records may be spelled differently.`}
                    />
                  </div>
                </section>

                <section className="k-card p-4">
                  <div className="k-card-head">
                    <h2 className="k-card-title">Coming up</h2>
                    <span className="k-mono text-[11px] text-k-mute">
                      {view.deadlines.length}
                    </span>
                  </div>
                  <div className="mt-3">
                    {view.deadlines.length === 0 ? (
                      <EmptyState title="Nothing due in the next fortnight" />
                    ) : (
                      <ul className="divide-y divide-k-line-2">
                        {view.deadlines.slice(0, 10).map((d, i) => (
                          <li
                            key={`${d.date}-${d.title}-${i}`}
                            className="py-2 first:pt-0"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="min-w-0 truncate text-[12.5px] text-k-ink">
                                {d.title}
                              </p>
                              <span className="k-mono shrink-0 text-[11px] text-k-mute">
                                {fmtDate(d.date)}
                              </span>
                            </div>
                            <p className="text-[11px] text-k-mute">
                              {d.client} · {d.tag}
                            </p>
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
