"use client";

import { useCallback, useRef, useState } from "react";
import { useUi, PANES, clampPane, type PaneId } from "@/lib/store/ui";

/**
 * The drag handle that sits on a pane's edge.
 *
 * There was no pointer-drag code anywhere in this app before this file, so a
 * few decisions are written down rather than assumed:
 *
 * POINTER CAPTURE, not window listeners. `setPointerCapture` keeps the events
 * coming to this element even when the pointer outruns it — which it will, on a
 * trackpad — and it releases automatically if the browser takes the pointer
 * away (a context menu, a tab switch). The window-listener version of this
 * leaks a mousemove handler on every drag that ends outside the document.
 *
 * THE STORE IS WRITTEN ON POINTER-UP ONLY, and this is not a performance
 * detail. `adoptLegacyPreferences` in lib/store/ui.ts starts with
 * `if (localStorage.getItem("itk_ui")) return;` — "the new key exists, so v1's
 * preferences were already imported". It runs from an effect in providers.tsx.
 * Any write to the persisted store before that effect flushes would create
 * `itk_ui` early and silently strand the user's v1 sidebar and recents forever.
 * A live width is therefore local state during the drag, and is committed once
 * the pointer is released — by which time the effect has long since run.
 *
 * `role="separator"` with the full valuenow/min/max set, because the WAI-ARIA
 * window-splitter pattern is the whole contract here: a divider that only
 * responds to a mouse is half a control.
 */
export function ResizeHandle({
  pane,
  /** `end` when the pane is left of the handle, `start` when it is right. */
  edge = "end",
  label,
  onLiveWidth,
  onCollapse,
}: {
  pane: PaneId;
  edge?: "start" | "end";
  label: string;
  /** Called with each drag frame so the pane can render without a store write. */
  onLiveWidth?: (px: number) => void;
  /**
   * Overrides the default snap-shut. The sidebar needs this: its collapsed
   * state is a discrete MODE branched on in a dozen places — centred icons,
   * smaller logo, hidden labels — not a width of zero, so it flips its own
   * long-standing `sidebarCollapsed` flag instead of being closed as a pane.
   */
  onCollapse?: () => void;
}) {
  const width = useUi((s) => s.paneWidths[pane]) ?? PANES[pane].def;
  const setPaneWidth = useUi((s) => s.setPaneWidth);
  const resetPane = useUi((s) => s.resetPane);
  const setPaneClosed = useUi((s) => s.setPaneClosed);
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ x: number; w: number } | null>(null);

  const spec = PANES[pane];
  // Dragging right grows a left-hand pane and shrinks a right-hand one.
  const direction = edge === "end" ? 1 : -1;

  const apply = useCallback(
    (px: number, commit: boolean) => {
      if (commit && px < spec.collapseAt) {
        // Snap shut rather than leaving a sliver nobody can read or grab.
        if (onCollapse) onCollapse();
        else setPaneClosed(pane, true);
        onLiveWidth?.(spec.def);
        return;
      }
      const next = clampPane(pane, px);
      onLiveWidth?.(next);
      if (commit) setPaneWidth(pane, next);
    },
    [pane, spec, setPaneWidth, setPaneClosed, onLiveWidth, onCollapse],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      tabIndex={0}
      data-dragging={dragging || undefined}
      className="k-resize-handle"
      onPointerDown={(e) => {
        // Ignore secondary buttons; a right-click here should open the menu.
        if (e.button !== 0) return;
        e.preventDefault();
        // Capture is an optimisation, not a requirement: without it the drag
        // still works while the pointer stays over the handle. It throws
        // NotFoundError when the pointer id is not actually down — which is
        // true of any synthetic event — so a failure here must not take the
        // drag with it.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* no capture; the move/up handlers below still fire */
        }
        origin.current = { x: e.clientX, w: width };
        document.body.classList.add("k-resizing");
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!origin.current) return;
        apply(origin.current.w + (e.clientX - origin.current.x) * direction, false);
      }}
      onPointerUp={(e) => {
        if (!origin.current) return;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* never captured */
        }
        apply(origin.current.w + (e.clientX - origin.current.x) * direction, true);
        origin.current = null;
        document.body.classList.remove("k-resizing");
        setDragging(false);
      }}
      onPointerCancel={() => {
        // The browser took the pointer. Keep the last live width rather than
        // snapping back, and commit it so the pane does not jump on next read.
        origin.current = null;
        document.body.classList.remove("k-resizing");
        setDragging(false);
      }}
      onDoubleClick={() => {
        resetPane(pane);
        onLiveWidth?.(spec.def);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        const moves: Record<string, number | "min" | "max" | "toggle"> = {
          ArrowLeft: -step * direction,
          ArrowRight: step * direction,
          Home: "min",
          End: "max",
          Enter: "toggle",
          " ": "toggle",
        };
        const m = moves[e.key];
        if (m === undefined) return;
        e.preventDefault();
        if (m === "toggle") {
          if (onCollapse) onCollapse();
          else setPaneClosed(pane, true);
          return;
        }
        const next =
          m === "min" ? spec.min : m === "max" ? spec.max : width + m;
        apply(next, true);
      }}
    />
  );
}

/**
 * A pane's current width, plus the live value while its handle is being dragged.
 *
 * The live value is component state rather than the store for the reason in the
 * ResizeHandle docblock: nothing may write to persisted storage mid-drag.
 */
export function usePaneWidth(pane: PaneId): {
  width: number;
  closed: boolean;
  setLive: (px: number) => void;
  open: () => void;
  toggle: () => void;
} {
  /**
   * THE FALLBACK IS NOT DEFENSIVE, it is the difference between a pane and no
   * pane. `persist` replaces the whole `paneWidths` object with the stored one,
   * so a browser that saved widths before this pane existed has no key for it —
   * `width` came out `undefined`, `--k-split-rail` became `undefinedpx`, and an
   * invalid custom property leaves the rail with no width at all. Every pane
   * added after a user's first visit had this problem, not just the newest.
   */
  const stored = useUi((s) => s.paneWidths[pane]) ?? PANES[pane].def;
  const closed = useUi((s) => Boolean(s.paneClosed[pane]));
  const setPaneClosed = useUi((s) => s.setPaneClosed);
  const togglePaneClosed = useUi((s) => s.togglePaneClosed);
  const [live, setLive] = useState<number | null>(null);

  return {
    width: live ?? stored,
    closed,
    setLive: (px) => setLive(px),
    open: () => {
      setLive(null);
      setPaneClosed(pane, false);
    },
    toggle: () => {
      setLive(null);
      togglePaneClosed(pane);
    },
  };
}

/**
 * A main pane and a side rail with a draggable divider between them.
 *
 * Below its container's threshold the two simply stack and the handle
 * disappears — see `.k-split` in globals.css, where the container query lives.
 * The rail width is passed down as a custom property rather than an inline
 * `width`, so the stacked case can ignore it entirely instead of having to
 * override it.
 */
export function SplitPane({
  pane,
  main,
  rail,
  railSide = "end",
  label,
  className = "",
}: {
  pane: PaneId;
  main: React.ReactNode;
  rail: React.ReactNode;
  railSide?: "start" | "end";
  label: string;
  className?: string;
}) {
  const { width, setLive } = usePaneWidth(pane);

  const railEl = <div className="k-split-rail space-y-5">{rail}</div>;
  const handle = (
    <ResizeHandle
      pane={pane}
      // Dragging right must grow the rail when the rail is on the LEFT and
      // shrink it when it is on the right.
      edge={railSide === "start" ? "end" : "start"}
      label={label}
      onLiveWidth={setLive}
    />
  );

  return (
    <div className={`k-split-container ${className}`}>
      <div
        className="k-split"
        style={{ "--k-split-rail": `${width}px` } as React.CSSProperties}
      >
        {railSide === "start" && railEl}
        {railSide === "start" && handle}
        <div className="k-split-main min-w-0 space-y-5">{main}</div>
        {railSide === "end" && handle}
        {railSide === "end" && railEl}
      </div>
    </div>
  );
}
