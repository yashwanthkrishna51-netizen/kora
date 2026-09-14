"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useClientList } from "@/lib/query/hooks";
import { useUi } from "@/lib/store/ui";
import { pickLanding } from "@/lib/domain/integrations";
import {
  inTracker,
  hasTrackerWork,
  trackerHref,
  type TrackerDomain,
} from "@/lib/domain/tracker";
import { PageSkeleton } from "@/components/ui/page-skeleton";

/**
 * The same width the client rail appears at — `hidden md:flex` in
 * tracker-shell.tsx. Below it there is no rail, so the index behind this is the
 * only way to pick a client and must not be skipped.
 */
const RAIL_QUERY = "(min-width: 768px)";

const mql = () => window.matchMedia(RAIL_QUERY);

function subscribe(onChange: () => void): () => void {
  const m = mql();
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

const hasRail = () => mql().matches;

/**
 * Assume the rail is there while rendering on the server.
 *
 * `matchMedia` does not exist there, and this has to return something. Assuming
 * the desktop means the server emits the skeleton — which is what the redirect
 * path wants and what `loading.tsx` was already showing, so the hand-off is
 * invisible. A phone corrects it on the first client render and gets the index.
 * Assuming the opposite would flash a grid of 26 clients at every desktop user
 * on the way past.
 */
const hasRailServer = () => true;

/**
 * A tracker opened with no client chosen: go to one instead of asking.
 *
 * The index behind this is a grid of every client, and on a desktop it sits
 * next to a rail listing exactly the same clients. Picking from two identical
 * lists is not a choice, it is a step — so this skips it and opens the client
 * you were last in, or the first one with work in it.
 *
 * ONE COMPONENT FOR ALL THREE TRACKERS. It was written for Integrations and
 * took three attempts to get right; the failure mode was a first-time visitor
 * left on a skeleton that never resolved, which no test caught and which only
 * appears on a browser with nothing stored. Copying that twice to give
 * Implementation and AMS the same behaviour would have been copying the
 * hazard, so the parts that differ are three lookups and everything else is
 * shared.
 *
 * THE INDEX IS NOT DEAD, which is why this cannot be a server redirect. Below
 * 768px the rail is hidden, so the index is the only way to pick a client at
 * all; a `redirect()` in the page would strand a phone on one client, and the
 * breadcrumb back to `/implementation` would just redirect again. The decision
 * needs the viewport, the viewport is not knowable on the server, so it is made
 * here — and read through `useSyncExternalStore` rather than mirrored into
 * state by an effect, the same treatment the theme class gets.
 *
 * This is the only effect-driven navigation in the app. It is deliberate and
 * narrow: one route per tracker, one condition, and `replace` rather than
 * `push` so Back goes where you came from instead of bouncing off the redirect.
 */
export function TrackerLanding({
  domain,
  children,
}: {
  domain: TrackerDomain;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const query = useClientList();
  const railVisible = useSyncExternalStore(subscribe, hasRail, hasRailServer);

  /**
   * The rail's own query, already hydrated by the layout — so this costs no
   * request and the ids are here on the first render.
   *
   * FILTERED THE SAME WAY THE RAIL IS, through the same function. Without it
   * this redirects to whatever is alphabetically first, which on Integrations
   * is a client with no integrations at all — landing you on an empty screen
   * that the rail beside it refuses to list.
   *
   * ORDERED, NOT FILTERED, BY WHETHER THERE IS WORK IN IT. The Implementation
   * rail's first client has zero modules, and opening its blank matrix is the
   * "choose a client" screen again in a different costume — so clients with
   * work sort first and `pickLanding` takes one of those as its fallback. They
   * are not dropped: a client you were last in is still reopened when it is
   * empty, because it is still in this list. Membership decides who is here;
   * this only decides who is first.
   */
  const ids = useMemo(() => {
    const rows = (query.data ?? []).filter((c) => inTracker(domain, c));
    const work = (c: (typeof rows)[number]) => hasTrackerWork(domain, c.counts);
    return [...rows.filter(work), ...rows.filter((c) => !work(c))].map(
      (c) => c.id,
    );
  }, [query.data, domain]);

  /**
   * THE REMEMBERED CLIENT IS READ IN THE EFFECT, not subscribed to in render,
   * and that is the whole design of this component.
   *
   * `persist` rehydrates while this module is evaluated — before React mounts
   * anything — so by the time an effect runs, `getState()` is the real answer,
   * synchronously and with no flag to wait on. Subscribing to it in render
   * instead means the value arrives through React's post-hydration snapshot
   * check, which is a race: it fired on some loads and not others, and when it
   * lost, the redirect never happened and a first-time visitor sat on a
   * skeleton forever. A redirect is a decision taken once; it must not depend
   * on whether a re-render happened to occur.
   */
  const redirecting = !query.isPending && railVisible && ids.length > 0;

  useEffect(() => {
    if (!redirecting) return;
    const target = pickLanding(useUi.getState().lastClient[domain], ids);
    if (target) router.replace(trackerHref(domain, target));
  }, [redirecting, domain, ids, router]);

  if (query.isPending || redirecting) {
    // SHAPED LIKE WHERE IT IS GOING, not like the index it is standing on.
    // Every `[clientId]/loading.tsx` renders a table, so a cards skeleton here
    // would be a visible swap one frame before the destination arrives.
    return <PageSkeleton shape="table" rows={9} />;
  }

  return <>{children}</>;
}
