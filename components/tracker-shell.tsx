"use client";

import { useParams } from "next/navigation";
import { PanelLeftOpen } from "lucide-react";
import { ClientRail, type Domain } from "@/components/client-rail";
import { trackerHref } from "@/lib/domain/tracker";
import { ResizeHandle, usePaneWidth } from "@/components/ui/resizable";

/**
 * Rail + content, the master-detail frame all three trackers share.
 *
 * Rendered from a LAYOUT rather than from each page, so the rail keeps its
 * scroll position and its filter text when you move between clients. Rendering
 * it per-page would remount it on every navigation — the list would jump back
 * to the top and clear the filter you just typed, which is exactly the
 * behaviour that made the old app's rail unusable with 22 clients.
 *
 * `useParams` rather than a prop because a layout does not re-render on a
 * param change in the App Router; reading the param in a client component is
 * what keeps the highlight in sync with the URL.
 */
export function TrackerShell({
  domain,
  children,
}: {
  domain: Domain;
  children: React.ReactNode;
}) {
  const params = useParams<{ clientId?: string }>();
  const rail = usePaneWidth("rail");

  return (
    <div className="flex h-full min-h-0">
      {/* The rail is desktop-only. Below 768px it would eat the screen; the
          mobile route is the index page's own list, which is the same data. */}
      {!rail.closed && (
        <div className="hidden md:flex">
          <ClientRail
            domain={domain}
            activeId={params.clientId}
            hrefFor={(c) => trackerHref(domain, c.id)}
            width={rail.width}
          />
          <ResizeHandle
            pane="rail"
            label="Resize client list"
            onLiveWidth={rail.setLive}
          />
        </div>
      )}

      {rail.closed && (
        <button
          type="button"
          onClick={rail.open}
          title="Show client list"
          aria-label="Show client list"
          className="hidden w-6 flex-none items-center justify-center border-r border-k-line bg-k-paper text-k-mute hover:bg-k-surface hover:text-k-primary md:flex"
        >
          <PanelLeftOpen size={14} strokeWidth={1.5} aria-hidden />
        </button>
      )}

      {/* @container, so everything inside sizes itself to THIS column rather
          than to the window. That is what makes dragging the rail change the
          layout of the page beside it — the viewport never moves, but the
          container genuinely does. */}
      <div className="@container min-w-0 flex-1 overflow-x-hidden">
        {children}
      </div>
    </div>
  );
}
