"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useClientTrees } from "@/lib/query/hooks";
import { QueryState, EmptyState } from "@/components/ui/states";
import { RagPill } from "@/components/ui/status";
import {
  integRagLabel,
  inIntegrationsTracker,
} from "@/lib/domain/integrations";
import { implAutoRag, implProgress } from "@/lib/domain/implementation";
import { amsClientRag, amsOpenCounts } from "@/lib/domain/ams";
import type { Domain } from "@/components/client-rail";
import type { Client } from "@/lib/domain/types";

/**
 * A tracker's index — the screen at `/integrations`, `/implementation`, `/ams`
 * with no client chosen.
 *
 * NO ARTBOARD COVERS THIS. Artboard 1c only ever draws the rail with a client
 * already selected, so the bare route is undesigned and this layout is my
 * extrapolation: the rail's own row, widened into a card, in a responsive grid.
 * Flagged for review rather than presented as designed.
 *
 * It earns its place by answering the question the rail cannot at a glance —
 * which client needs attention — since each card carries the same RAG the
 * client's own screen computes, from the same domain function. Below 768px it
 * is also the only way to pick a client, because the rail is hidden there.
 */
export function TrackerIndex({ domain }: { domain: Domain }) {
  const query = useClientTrees();

  /**
   * SHOW ALL is the escape hatch this screen needs and the rail gets for free.
   *
   * Integrations lists a client only once it has one — see
   * `inIntegrationsTracker`. The rail lifts that rule when you type in its
   * filter box; this screen has no filter box, and below 768px it is the ONLY
   * client picker. Since the `+ Integration` button lives on the client's own
   * page and nothing else in the app can give a client its first integration,
   * hiding with no way back would strand a phone.
   *
   * Local state, not persisted: it is a "let me see everything for a second",
   * not a preference.
   */
  const [showAll, setShowAll] = useState(false);

  /**
   * DOMAIN MEMBERSHIP FROM KEY PRESENCE, not from `hasImplementation`.
   *
   * This screen runs on TREES, and a tree has no such flag: `toV1Shape` builds
   * from v1's field whitelist, which predates migration 0003, so it emits the
   * v1 null-sentinel instead — `modules` present (even as `[]`) means in the
   * domain, absent means not. Reading the flag here returned `undefined` for
   * every client, and both the Implementation and the AMS index rendered "No
   * clients in this tracker yet" over a rail listing twenty-two of them.
   *
   * `lib/export/excel.ts` reads the same trees the same way and says so. The
   * rail beside this one reads `hasImplementation` and is right to: it runs on
   * `ClientSummary`, which carries the flags and has no children to be present
   * or absent.
   */
  const inDomain = useMemo(() => {
    const all = query.data ?? [];
    return all.filter((c) =>
      domain === "implementation"
        ? c.modules !== undefined
        : domain === "ams"
          ? c.workLog !== undefined
          : true,
    );
  }, [query.data, domain]);

  const hidden = useMemo(
    () =>
      domain === "integrations"
        ? inDomain.filter(
            (c) => !inIntegrationsTracker((c.integrations ?? []).length),
          ).length
        : 0,
    [inDomain, domain],
  );

  const rows = useMemo(() => {
    const listed =
      domain === "integrations" && !showAll
        ? inDomain.filter((c) =>
            inIntegrationsTracker((c.integrations ?? []).length),
          )
        : inDomain;
    return listed.map((c) => ({ client: c, ...summarise(c, domain) }));
  }, [inDomain, domain, showAll]);

  const title =
    domain === "implementation"
      ? "Implementation"
      : domain === "ams"
        ? "AMS & Support"
        : "Integrations";

  return (
    <div className="k-page">
      <h1 className="k-page-title">{title}</h1>
      <p className="mt-1 text-[12.5px] text-k-mute">
        {rows.length} client{rows.length === 1 ? "" : "s"} in this tracker.
        Choose one to see its detail.
        {hidden > 0 && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="font-semibold text-k-primary hover:underline"
            >
              {showAll
                ? "Hide the empty ones"
                : `Show ${hidden} with no integrations`}
            </button>
          </>
        )}
      </p>

      <div className="mt-5">
        <QueryState
          isPending={query.isPending}
          isPaused={query.isPaused}
          error={query.error}
          onRetry={() => query.refetch()}
          isEmpty={rows.length === 0}
          skeletonRows={6}
          empty={
            <EmptyState
              title="No clients in this tracker yet"
              // Domain-aware, because the old single sentence was simply untrue
              // of Integrations: there is nothing to be "added to".
              hint={
                domain === "integrations"
                  ? "A client appears here once it has an integration."
                  : "A client appears here once it is added to this domain."
              }
            />
          }
        >
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ client, rag, primary, secondary }) => (
              <li key={client.id}>
                <Link
                  href={`/${domain}/${client.id}`}
                  className="k-card k-card-hover group flex h-full flex-col gap-2 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="k-card-title min-w-0 truncate">
                      {client.name}
                    </span>
                    <ChevronRight
                      size={15}
                      strokeWidth={1.5}
                      aria-hidden
                      className="mt-px shrink-0 text-k-mute-2 transition-transform group-hover:translate-x-0.5"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    {rag ? (
                      <RagPill rag={rag} />
                    ) : (
                      <span className="text-[11px] text-k-mute">No status</span>
                    )}
                  </div>

                  <dl className="mt-auto flex items-baseline gap-4 pt-1">
                    <div>
                      <dd className="k-num text-[20px] leading-none">
                        {primary.value}
                      </dd>
                      <dt className="k-eyebrow mt-1">{primary.label}</dt>
                    </div>
                    <div>
                      <dd className="k-num text-[20px] leading-none text-k-ink-3">
                        {secondary.value}
                      </dd>
                      <dt className="k-eyebrow mt-1">{secondary.label}</dt>
                    </div>
                  </dl>

                  {client.masterAssignee && (
                    <p className="truncate text-[11px] text-k-mute">
                      Lead: {client.masterAssignee}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </QueryState>
      </div>
    </div>
  );
}

/**
 * Each tracker's headline numbers, from the same domain functions its own
 * screen uses — never recomputed inline here, so a card and the screen behind
 * it can never disagree.
 */
function summarise(c: Client, domain: Domain) {
  if (domain === "implementation") {
    const p = implProgress(c);
    return {
      rag: implAutoRag(c),
      primary: { value: `${p.pct}%`, label: "complete" },
      secondary: { value: c.modules?.length ?? 0, label: "modules" },
    };
  }

  if (domain === "ams") {
    const open = amsOpenCounts(c);
    return {
      rag: amsClientRag(c),
      primary: { value: open.open, label: "open" },
      secondary: { value: c.workLog?.length ?? 0, label: "entries" },
    };
  }

  const integrations = c.integrations ?? [];
  const done = integrations.filter((i) => i.status === "Completed").length;
  return {
    rag: integRagLabel(c),
    primary: { value: integrations.length, label: "integrations" },
    secondary: { value: done, label: "completed" },
  };
}
