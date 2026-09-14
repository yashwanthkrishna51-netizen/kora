"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api/fetcher";
import { adoptLegacyPreferences } from "@/lib/store/ui";

/**
 * Client-side providers.
 *
 * The query defaults replace the old app's `backgroundRefreshClients()` — a
 * bare 60-second `setInterval` that re-fetched every client, then took care to
 * skip when a modal was open or the tab was hidden so it would not clobber an
 * in-progress edit. React Query does the skipping properly: it pauses when the
 * tab is hidden, dedupes concurrent requests, and never replaces data a
 * mutation is currently touching.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // NEVER PAUSE A QUERY. React Query's default `networkMode: "online"`
        // does not run `queryFn` at all when its `onlineManager` believes the
        // browser is offline: the query is created `paused`, `status` stays
        // "pending" forever, and NO ERROR IS EVER PRODUCED. `QueryState` then
        // renders a skeleton with no message and no retry — which is exactly
        // what "the admin panel shows nothing" and "it hangs for a minute then
        // everything appears at once" look like from the outside.
        //
        // Worse, that manager does not seed from `navigator.onLine` (it starts
        // `true` and only flips on window online/offline events), so whether
        // you get a silent hang or a raw TypeError depends on WHEN the browser
        // went offline. Reproduced: navigating to an unvisited client while
        // offline issued no /api request at all and span eight skeletons.
        //
        // "always" means we attempt the request and surface a real failure.
        // That matches what this file already demands of writes below.
        networkMode: "always",
        // A client tree is expensive to build and changes on human timescales.
        staleTime: 30_000,
        // NO GLOBAL POLLING. This used to be `refetchInterval: 60_000`, which
        // every query inherited unless it opted out — and the ones that had not
        // opted out were the heaviest: the per-client tree behind every detail
        // screen, the client list behind every rail, and the user list. Three
        // requests a minute per open tab, each one changing object identity and
        // re-running every aggregate downstream of it.
        //
        // Polling is now opt-in per query. `refetchOnWindowFocus` below still
        // catches the case this was really for — someone coming back to a tab
        // and acting on stale numbers — and it respects `staleTime`, which an
        // interval does not.
        refetchInterval: false,
        // The old app had no equivalent; coming back to a stale tab and acting
        // on week-old numbers is exactly how two people overwrite each other.
        refetchOnWindowFocus: true,
        retry(failureCount, error) {
          // Retrying a 401 or a 403 cannot succeed, and retrying a 409 would
          // race the conflict the user needs to see. Only transient failures
          // are worth a second attempt.
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        // Same reasoning, and the stakes are higher: a paused mutation looks to
        // the user like a save that worked and then quietly did not.
        networkMode: "always",
        // Never automatic. A write that failed must surface, not silently
        // replay — the old app's optimistic handlers rolled back by hand and a
        // hidden retry would have fought them.
        retry: false,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Created in state, not at module scope: a module-level client would be
  // shared across requests on the server and leak one user's data into
  // another's cache.
  const [queryClient] = useState(makeQueryClient);

  useEffect(() => {
    adoptLegacyPreferences();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          // Sonner's own palette is not ours; these map onto the k-* tokens so
          // toasts match the app in both themes.
          className: "k-toast",
          duration: 4000,
        }}
      />
    </QueryClientProvider>
  );
}
