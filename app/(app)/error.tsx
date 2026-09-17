"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * A render error inside a tracker screen.
 *
 * Separate from app/error.tsx so the sidebar, breadcrumbs and banners SURVIVE
 * it — this renders in the content area, not over the whole window. One broken
 * screen should not cost you the navigation to get off it.
 */
export default function SectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Screen failed to render:", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="p-7">
      <div className="k-conflict max-w-lg" role="alert">
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            size={15}
            strokeWidth={1.5}
            aria-hidden
            className="mt-px shrink-0 text-k-text-amber"
          />
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-k-text-amber">
              This screen could not be shown
            </p>
            <p className="mt-1 text-[12px] text-k-ink-3">
              The rest of the app still works — use the sidebar to move
              elsewhere, or try this screen again.
              {error.digest && (
                <>
                  {" "}
                  Reference <span className="k-mono">{error.digest}</span>.
                </>
              )}
            </p>
            <button
              type="button"
              onClick={reset}
              className="k-btn k-btn-outline k-btn-sm mt-2.5"
            >
              <RotateCw size={12} strokeWidth={1.5} aria-hidden />
              Try again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
