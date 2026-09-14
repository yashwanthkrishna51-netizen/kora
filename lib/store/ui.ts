"use client";

import { create } from "zustand";
import type { IntegSort } from "@/lib/domain/integrations";
import type { TrackerDomain } from "@/lib/domain/tracker";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * UI preferences that outlive a page load.
 *
 * THE STORAGE KEYS ARE THE OLD APP'S, deliberately. At cutover everyone's
 * browser already holds `itk_sb_collapsed` and `itk_recent` from years of
 * using v1; reading the same keys means a collapsed sidebar stays collapsed
 * and recent items survive the switch. It costs nothing and it is the
 * difference between the new app feeling like an upgrade and feeling like a
 * reset.
 *
 * Two of the old keys are deliberately NOT carried over:
 *
 *   `itk_sess`  held `btoa(JSON.stringify({token, user}))` — the session in
 *               localStorage, readable by any script on the page. That is the
 *               whole reason the session is an httpOnly cookie now.
 *   `itk_view`  restored the last route on load. The URL does that, and doing
 *               both means a deep link silently loses to a stale preference.
 *
 * Dark mode is NOT here either. It lives on the <html> class, applied before
 * first paint by the inline script in app/layout.tsx, and is read through
 * useSyncExternalStore in components/theme.tsx — putting it in a hydrated
 * store as well would give it two sources of truth and a flash.
 */

export interface RecentItem {
  /** Route to return to. */
  href: string;
  label: string;
  sub?: string;
  kind: "client" | "integration" | "module" | "phase" | "ams";
}

const MAX_RECENT = 8;

/**
 * The resizable layout panes.
 *
 * Widths live here rather than in each component because they must survive a
 * reload and a route change, and because the same pane is rendered by different
 * screens — the client rail is one pane across all three trackers, not three.
 */
export type PaneId =
  | "sidebar"
  | "rail"
  | "phasePanel"
  | "integDetail"
  | "integList"
  | "phaseDetail"
  | "amsRail";

/**
 * Default, minimum and maximum width per pane, in px.
 *
 * The minimums are not decoration: below them the pane's own content starts to
 * overflow, and `tracker-shell` clips horizontally rather than scrolling, so an
 * under-sized pane truncates silently. `collapseAt` is where a drag gives up
 * and snaps shut.
 */
export const PANES: Record<
  PaneId,
  { min: number; max: number; def: number; collapseAt: number }
> = {
  sidebar: { min: 180, max: 360, def: 232, collapseAt: 150 },
  rail: { min: 200, max: 420, def: 268, collapseAt: 170 },
  phasePanel: { min: 260, max: 680, def: 300, collapseAt: 220 },
  integDetail: { min: 240, max: 480, def: 300, collapseAt: 210 },
  integList: { min: 260, max: 420, def: 320, collapseAt: 230 },
  phaseDetail: { min: 220, max: 440, def: 250, collapseAt: 190 },
  amsRail: { min: 240, max: 480, def: 300, collapseAt: 210 },
};

export const clampPane = (id: PaneId, px: number): number =>
  Math.max(PANES[id].min, Math.min(PANES[id].max, Math.round(px)));

const defaultPaneWidths = (): Record<PaneId, number> =>
  Object.fromEntries(
    (Object.keys(PANES) as PaneId[]).map((k) => [k, PANES[k].def]),
  ) as Record<PaneId, number>;

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  recent: RecentItem[];
  pushRecent: (item: RecentItem) => void;

  /**
   * Pane widths in px, always clamped to that pane's range.
   *
   * PARTIAL, and that is the honest type rather than a defensive one. `persist`
   * merges the stored envelope over the initial state SHALLOWLY, so a stored
   * `paneWidths` written before a pane existed replaces the complete default
   * object with an incomplete one — every browser that used the app before a
   * new pane was added is missing that key. Typing it `Record` told the
   * compiler every pane was present and hid exactly that.
   */
  paneWidths: Partial<Record<PaneId, number>>;
  /** Panes the user has shut. The sidebar keeps its own older flag. */
  paneClosed: Partial<Record<PaneId, boolean>>;
  setPaneWidth: (id: PaneId, px: number) => void;
  togglePaneClosed: (id: PaneId) => void;
  setPaneClosed: (id: PaneId, closed: boolean) => void;
  resetPane: (id: PaneId) => void;

  /**
   * WHERE YOU WERE, so landing on a tracker lands on work rather than on a
   * chooser. All three trackers now redirect to this when opened with no client
   * picked, and opening a client reopens the record you last had open in it.
   *
   * A MAP, keyed by tracker, rather than one field per tracker: the landing
   * component is parameterised by domain and would otherwise need a switch to
   * find its own field. `lastIntegration` below is already shaped this way.
   *
   * It replaces `lastIntegrationsClient`, and the old key is deliberately not
   * migrated — the shallow merge leaves it sitting unread in localStorage and
   * the cost is one visit, after which this remembers again.
   *
   * Ids, not objects: a remembered client or integration can be archived
   * between visits, so every read goes through `pickLanding`, which falls back
   * to the first row rather than rendering an empty screen.
   */
  lastClient: Partial<Record<TrackerDomain, string>>;
  /** clientId -> integId. Per client, because "where I was" is per client. */
  lastIntegration: Record<string, string>;
  rememberClient: (domain: TrackerDomain, clientId: string) => void;
  rememberIntegration: (clientId: string, integId: string) => void;

  /** How the integration list is ordered. A view preference, so it persists. */
  integSort: IntegSort;
  setIntegSort: (mode: IntegSort) => void;

  /**
   * Has the persisted slice arrived? Part of the STATE, deliberately.
   *
   * It used to be read off `persist.hasHydrated()` through
   * `useSyncExternalStore`, and that had a hole big enough to hang the app on.
   * The subscription there is `onFinishHydration`, a one-shot that never fires
   * if hydration finished first — and the only other thing that re-rendered a
   * reader was some OTHER value changing during rehydration. On a browser with
   * nothing stored, rehydration writes the same empty values, nothing changes,
   * nothing re-renders, and the flag stays false forever. The integrations
   * landing gates its redirect on it, so a first-time visitor sat on a skeleton
   * that never resolved.
   *
   * As a state field it goes false -> true, which IS a change, so every
   * subscriber is notified exactly once, by the same mechanism as everything
   * else in this store. Excluded from `partialize`: it describes this page
   * load, not a preference.
   */
  hydrated: boolean;
  setHydrated: () => void;

  /** Admin-only preview of a lesser role. Memory-only — see below. */
  viewAsRole: "editor" | "viewer" | null;
  setViewAsRole: (r: "editor" | "viewer" | null) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      recent: [],
      pushRecent: (item) =>
        set((s) => ({
          // Most recent first, de-duplicated by href, capped. Same shape the
          // old app kept, so a carried-over list renders without migration.
          recent: [item, ...s.recent.filter((r) => r.href !== item.href)].slice(
            0,
            MAX_RECENT,
          ),
        })),

      paneWidths: defaultPaneWidths(),
      paneClosed: {},
      setPaneWidth: (id, px) =>
        set((s) => ({
          paneWidths: { ...s.paneWidths, [id]: clampPane(id, px) },
        })),
      togglePaneClosed: (id) =>
        set((s) => ({
          paneClosed: { ...s.paneClosed, [id]: !s.paneClosed[id] },
        })),
      setPaneClosed: (id, closed) =>
        set((s) => ({ paneClosed: { ...s.paneClosed, [id]: closed } })),
      resetPane: (id) =>
        set((s) => ({
          paneWidths: { ...s.paneWidths, [id]: PANES[id].def },
          paneClosed: { ...s.paneClosed, [id]: false },
        })),

      lastClient: {},
      lastIntegration: {},
      rememberClient: (domain, clientId) =>
        set((s) => ({ lastClient: { ...s.lastClient, [domain]: clientId } })),
      rememberIntegration: (clientId, integId) =>
        set((s) => ({
          lastIntegration: { ...s.lastIntegration, [clientId]: integId },
        })),

      integSort: "worst",
      setIntegSort: (mode) => set({ integSort: mode }),

      hydrated: false,
      setHydrated: () => set({ hydrated: true }),

      viewAsRole: null,
      setViewAsRole: (r) => set({ viewAsRole: r }),
    }),
    {
      name: "itk_ui",
      storage: createJSONStorage(() => localStorage),
      /**
       * `viewAsRole` is excluded from persistence on purpose.
       *
       * It is a preview an admin turns on to check what an editor sees. If it
       * survived a reload, an admin could return the next morning, find half
       * the app missing, and have no idea why — the old app kept it in memory
       * for exactly this reason. It is also client-side only and never
       * influences a server authorisation decision; the session still carries
       * the real role and every API route re-checks it.
       */
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        recent: s.recent,
        paneWidths: s.paneWidths,
        paneClosed: s.paneClosed,
        lastClient: s.lastClient,
        lastIntegration: s.lastIntegration,
        integSort: s.integSort,
      }),
      /**
       * STILL 1, and deliberately so. There is no `migrate` here, and zustand
       * DISCARDS persisted state entirely on a version bump when none is
       * supplied — bumping this to add two keys would throw away everyone's
       * sidebar preference and recents to gain nothing. `persist` merges the
       * stored object shallowly over the initial state, so an older envelope
       * that predates `paneWidths` simply falls back to the defaults above.
       */
      version: 1,
      /**
       * Flip `hydrated` once the stored slice has been merged in.
       *
       * CALLED ON THE STATE ZUSTAND HANDS BACK, not through the `useUi` binding
       * above — `persist` runs this inside `create(...)`, where that binding is
       * still in its temporal dead zone. Reaching for it there throws a
       * ReferenceError that zustand swallows, which leaves the flag false and
       * hangs every screen that waits on it.
       *
       * `state` is undefined only when storage itself threw. That still counts
       * as settled: a browser with storage disabled is never going to produce a
       * stored slice, and a reader that waits forever is worse than one that
       * proceeds with defaults. By then `create` has returned, so the binding
       * is safe.
       */
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated();
          return;
        }
        queueMicrotask(() => useUi.setState({ hydrated: true }));
      },
    },
  ),
);

/**
 * Reads the old app's standalone keys once, on first load.
 *
 * v1 wrote `itk_sb_collapsed` as a bare `'1'`/`'0'` string and `itk_recent` as
 * a bare JSON array, not inside a Zustand envelope. This lifts them into the
 * store the first time the new app runs and then leaves them alone — it does
 * not delete them, because the old app is still live until cutover and would
 * lose the preference.
 */
export function adoptLegacyPreferences(): void {
  try {
    if (localStorage.getItem("itk_ui")) return; // already migrated

    const collapsed = localStorage.getItem("itk_sb_collapsed");
    if (collapsed === "1" || collapsed === "0") {
      useUi.getState().setSidebarCollapsed(collapsed === "1");
    }

    const recentRaw = localStorage.getItem("itk_recent");
    if (recentRaw) {
      const parsed: unknown = JSON.parse(recentRaw);
      if (Array.isArray(parsed)) {
        // v1 stored {type,label,sub,view,params}; the route is rebuilt from
        // view+params rather than carried, so anything unrecognised is
        // dropped instead of producing a link that 404s.
        for (const r of parsed.slice(0, MAX_RECENT).reverse()) {
          const href = legacyHref(r as LegacyRecent);
          if (href) {
            useUi.getState().pushRecent({
              href,
              label: String((r as LegacyRecent).label ?? ""),
              sub: (r as LegacyRecent).sub,
              kind: legacyKind((r as LegacyRecent).view),
            });
          }
        }
      }
    }
  } catch {
    // Storage disabled or corrupt. Preferences are a convenience; losing them
    // must never stop the app loading.
  }
}

interface LegacyRecent {
  view?: string;
  label?: string;
  sub?: string;
  params?: {
    clientId?: string;
    integId?: string;
    moduleId?: string;
    phase?: string;
  };
}

function legacyHref(r: LegacyRecent): string | null {
  const p = r.params ?? {};
  const e = encodeURIComponent;
  switch (r.view) {
    case "dashboard":
      return "/dashboard";
    case "clients":
      return "/integrations";
    case "client-detail":
      return p.clientId ? `/integrations/${e(p.clientId)}` : null;
    case "integ-detail":
      return p.clientId && p.integId
        ? `/integrations/${e(p.clientId)}/${e(p.integId)}`
        : null;
    case "impl-clients":
      return "/implementation";
    case "impl-client-detail":
      return p.clientId ? `/implementation/${e(p.clientId)}` : null;
    case "impl-phase-detail":
      return p.clientId && p.moduleId && p.phase
        ? `/implementation/${e(p.clientId)}/${e(p.moduleId)}/${e(p.phase)}`
        : null;
    case "ams-clients":
      return "/ams";
    case "ams-client-detail":
      return p.clientId ? `/ams/${e(p.clientId)}` : null;
    case "admin":
      return "/admin";
    default:
      return null;
  }
}

function legacyKind(view: string | undefined): RecentItem["kind"] {
  if (view?.startsWith("integ")) return "integration";
  if (view?.startsWith("impl"))
    return view === "impl-phase-detail" ? "phase" : "module";
  if (view?.startsWith("ams")) return "ams";
  return "client";
}

/**
 * The role the UI should behave as.
 *
 * View-as is a preview for an admin and nothing more: it never reaches the
 * server, the session still carries the real role, and every route re-checks
 * it. So this can only ever hide UI, never grant it — which is why it is safe
 * to compute in the browser.
 *
 * It lives here rather than inside the chrome because two places need the same
 * answer: the sidebar, which hides the Admin link, and the dashboard, which
 * swaps to an entirely different screen. Computing it twice is how those two
 * come to disagree, leaving an admin previewing as an editor looking at the
 * portfolio dashboard with the Admin link hidden.
 */
export function useEffectiveRole(realRole: string): string {
  const viewAsRole = useUi((s) => s.viewAsRole);
  return realRole === "admin" && viewAsRole ? viewAsRole : realRole;
}

/**
 * Has the stored slice actually arrived?
 *
 * A plain selector now. See the `hydrated` field above for why this is not
 * `persist.hasHydrated()` read through `useSyncExternalStore` — that version
 * never updated on a browser with nothing stored yet.
 */
export function useUiHydrated(): boolean {
  return useUi((s) => s.hydrated);
}
