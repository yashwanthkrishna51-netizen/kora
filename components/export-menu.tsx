"use client";

import { useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface ExportItem {
  label: string;
  /** Runs on click. Rejections are toasted; the menu closes either way. */
  run: () => Promise<void> | void;
  /** Shown greyed with this reason instead of running. */
  disabledReason?: string;
}

/**
 * The Export ▾ dropdown, shared by every screen that has one.
 *
 * Replaces v1's `exportMenuButton` (`kora/js/core.js:515`), which was a
 * hand-rolled click-toggle backed by a single global `S.openExportMenu` — so
 * only one menu in the app could be open at a time, by construction, and the
 * outside-click handler had to be maintained by hand. Radix owns focus,
 * keyboard navigation and dismissal here; the app owns what the items do.
 *
 * v1's choice of click over hover is worth keeping and is why this is a menu
 * rather than a `:hover` panel — its comment explains that a hover menu closes
 * the instant the pointer leaves the button on its way to an item.
 *
 * Generating a report takes a moment on a large client, so the trigger shows a
 * spinner and refuses re-entry. v1 had no busy state at all: a second click
 * started a second generation, and on a slow machine you could queue several
 * and get several downloads.
 */
export function ExportMenu({
  items,
  label = "Export",
  align = "end",
  tone = "outline",
  size = "sm",
}: {
  items: ExportItem[];
  label?: string;
  align?: "start" | "end";
  /** `primary` for a screen's headline export — artboard 1b's Portfolio Export. */
  tone?: "outline" | "primary";
  /** `md` is the handoff's 34px header button; `sm` the 30px in-card one. */
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);

  if (!items.length) return null;

  async function run(item: ExportItem) {
    if (busy) return;
    setBusy(true);
    try {
      await item.run();
    } catch (err) {
      // Reported, never swallowed. An export that silently does nothing is the
      // single most confusing failure on these screens, because the person is
      // left waiting for a download that is never coming.
      toast.error(
        err instanceof Error
          ? `Could not generate that: ${err.message}`
          : "Could not generate that.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Menu.Root>
      <Menu.Trigger asChild disabled={busy}>
        <button
          type="button"
          className={`k-btn k-btn-${tone} k-btn-${size}`}
          aria-label={busy ? "Generating export" : label}
        >
          {busy ? (
            <Loader2 size={13} strokeWidth={1.5} aria-hidden className="animate-spin" />
          ) : (
            <Download size={13} strokeWidth={1.5} aria-hidden />
          )}
          {busy ? "Generating…" : label}
        </button>
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-[230px] rounded-k border border-k-line bg-k-paper p-1 shadow-[var(--k-shadow-m)]"
        >
          {items.map((item) => (
            <Menu.Item
              key={item.label}
              className="k-menu-item"
              disabled={Boolean(item.disabledReason)}
              // `onSelect` fires before the menu unmounts, so the work is
              // started outside it — otherwise a slow generator keeps a closing
              // menu alive and the spinner never renders.
              onSelect={() => {
                if (item.disabledReason) return;
                queueMicrotask(() => void run(item));
              }}
              title={item.disabledReason}
            >
              {item.label}
              {item.disabledReason && (
                <span className="ml-auto pl-3 text-[10.5px] text-k-mute-2">
                  {item.disabledReason}
                </span>
              )}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
