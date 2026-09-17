"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw, LayoutGrid } from "lucide-react";

/**
 * The last line of defence for a render-time exception.
 *
 * Without this file Next falls back to its own production page: a white screen
 * reading "Application error: a client-side exception has occurred", with no
 * branding, no navigation and no way back except the browser's Back button.
 * For an internal tool that is indistinguishable from the app being down.
 *
 * `QueryState` in components/ui/states.tsx already handles FETCH failures well.
 * It cannot catch a component throwing while it renders — that is what this is
 * for, and the two are not substitutes.
 *
 * `reset()` re-renders the segment without a full reload, so an error caused by
 * one bad payload clears as soon as the query refetches. The reload link is the
 * escape hatch when it does not.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server already logs its own failures with a correlation id. This is
    // the client half, and it is the only record that this happened at all.
    console.error("Unhandled render error:", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-k-surface p-6">
      <div className="k-card w-full max-w-md p-6" role="alert">
        <AlertTriangle
          size={22}
          strokeWidth={1.5}
          aria-hidden
          className="text-k-text-amber"
        />
        <h1 className="k-card-title mt-3">This screen could not be shown</h1>
        <p className="mt-2 text-[12.5px] text-k-ink-3">
          Something went wrong rendering this page. Your work has not been lost —
          nothing is saved until you make a change, and changes that had already
          saved are safe.
        </p>

        {error.digest && (
          <p className="mt-3 text-[11px] text-k-mute">
            Reference{" "}
            <span className="k-mono text-k-ink-3">{error.digest}</span> — quote
            this if you report it.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={reset} className="k-btn k-btn-primary k-btn-sm">
            <RotateCw size={13} strokeWidth={1.5} aria-hidden />
            Try again
          </button>
          <a href="/dashboard" className="k-btn k-btn-outline k-btn-sm">
            <LayoutGrid size={13} strokeWidth={1.5} aria-hidden />
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
