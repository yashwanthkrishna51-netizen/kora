"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Inbox } from "lucide-react";
import { ApiError } from "@/lib/api/fetcher";

/**
 * Loading, empty and error, as three components rather than three ad-hoc
 * ternaries per screen.
 *
 * The old app had one global spinner overlay and nothing else, so an empty
 * table and a failed request looked identical: blank. Distinguishing them is
 * most of what makes a read-only screen trustworthy — "there is nothing here"
 * and "we could not find out" are opposite messages.
 */

/**
 * A skeleton that does not flash.
 *
 * Nothing renders for the first 200ms. A query served from cache resolves in
 * ~5ms, and a skeleton that appears and disappears inside one frame reads as a
 * glitch — the handoff calls for the delay explicitly and the old app's
 * overlay had the same 200ms guard for the same reason.
 */
export function DelayedSkeleton({
  rows = 6,
  delay = 200,
}: {
  rows?: number;
  delay?: number;
}) {
  const show = useDelay(delay);
  if (!show) return null;

  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="k-skeleton"
          style={{
            height: 34,
            // Slight variation so it reads as content rather than as a
            // loading bar; the last row short, as a paragraph would be.
            width: i === rows - 1 ? "62%" : "100%",
          }}
        />
      ))}
    </div>
  );
}

export function useDelay(ms: number): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return show;
}

/** Nothing to show, and that is the correct answer. */
export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
}: {
  title: string;
  hint?: string;
  icon?: typeof Inbox;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Icon size={22} strokeWidth={1.5} className="text-k-mute-2" />
      <p className="text-[13px] font-semibold text-k-ink">{title}</p>
      {hint && <p className="max-w-sm text-[12px] text-k-mute">{hint}</p>}
    </div>
  );
}

/**
 * A request failed.
 *
 * Shows the server's own message when there is one. Those messages are written
 * for people ("That client no longer exists", "This change needs a version to
 * check against") and are strictly more useful than a generic apology — the
 * API deliberately never returns driver text, so there is nothing here to
 * leak.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : "Something went wrong loading this.";

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="k-callout flex items-start gap-2.5" role="alert">
      <AlertCircle size={16} strokeWidth={1.5} className="mt-px shrink-0 text-k-risk" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-k-ink">
          {offline ? "You are offline" : message}
        </p>
        {offline && (
          <p className="mt-0.5 text-[12px] text-k-mute">
            The browser reports no connection. You can still try again — that
            report is sometimes wrong.
          </p>
        )}
        {/* ALWAYS OFFERED, including offline. It used to be hidden exactly when
            `navigator.onLine` was false, which is the one moment someone most
            wants it: the browser's offline flag is a hint, not a fact, and a
            dead end with no button is worse than a retry that fails. */}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="k-btn k-btn-outline k-btn-sm mt-2"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The three states in one wrapper, since every screen needs the same shape.
 *
 * Loading is checked before error deliberately: React Query keeps the previous
 * `error` while a refetch is in flight, so checking error first would show a
 * stale failure over data that is on its way.
 */
export function QueryState({
  isPending,
  isPaused,
  error,
  isEmpty,
  empty,
  onRetry,
  skeletonRows,
  children,
}: {
  isPending: boolean;
  /**
   * `query.isPaused` — a query React Query declined to run.
   *
   * Checked BEFORE `isPending`, because a paused query is also pending and
   * would otherwise render as a skeleton that never resolves: no request, no
   * error, no explanation. `networkMode: "always"` in providers.tsx should mean
   * this never happens now; it is handled anyway so that turning that setting
   * back on cannot silently reintroduce a screen that hangs forever.
   */
  isPaused?: boolean;
  error: unknown;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  onRetry?: () => void;
  skeletonRows?: number;
  children: React.ReactNode;
}) {
  if (isPaused) {
    return (
      <ErrorState
        error={new ApiError(0, "Waiting for a connection before loading this.")}
        onRetry={onRetry}
      />
    );
  }
  if (isPending) return <DelayedSkeleton rows={skeletonRows} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isEmpty) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children}</>;
}
