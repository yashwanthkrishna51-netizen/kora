"use client";

import { useUi } from "@/lib/store/ui";

/**
 * View as — the missing entry point.
 *
 * Everything behind this has existed since step 13: `useEffectiveRole`, the
 * banner, the exit chip, and `useCanEdit` honouring the preview. But
 * `setViewAsRole` was only ever called with `null` — the exit path — because
 * its activation point was always meant to be this card, and this screen was a
 * stub. So the whole feature has been built and unreachable.
 *
 * Two buttons rather than a select-plus-Preview, per the artboard. There is no
 * "admin" option: previewing your own role is a no-op, and offering it implies
 * the control does something it does not.
 *
 * The preview is memory-only — `partialize` deliberately excludes it — so a
 * reload always returns a real admin to real admin. An admin who forgets they
 * are previewing and closes the laptop does not come back tomorrow apparently
 * locked out of their own tools.
 */
export function ViewAsCard() {
  const viewAsRole = useUi((s) => s.viewAsRole);
  const setViewAsRole = useUi((s) => s.setViewAsRole);

  return (
    <div className="k-card p-[16px_18px]">
      <div className="k-eyebrow mb-2.5">View as</div>
      <p className="mb-3 text-[12px] leading-[1.6] text-k-mute">
        Preview Kora exactly as a lower role sees it. Your real admin access is
        unchanged.
      </p>

      <div className="flex gap-2">
        {(["editor", "viewer"] as const).map((role) => {
          const active = viewAsRole === role;
          const label = role[0].toUpperCase() + role.slice(1);
          return (
            <button
              key={role}
              type="button"
              aria-pressed={active}
              onClick={() => setViewAsRole(active ? null : role)}
              className={
                "k-btn k-btn-sm flex-1 " +
                (active
                  ? "k-btn-primary"
                  : role === "editor"
                    ? "k-btn-outline-brand"
                    : "k-btn-outline")
              }
            >
              {active ? `Previewing as ${role}` : label}
            </button>
          );
        })}
      </div>

      {viewAsRole && (
        <p className="mt-3 text-[11.5px] leading-[1.5] text-k-mute">
          Press the active button again, use the banner at the top of the
          window, or reload to exit.
        </p>
      )}
    </div>
  );
}
