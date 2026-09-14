"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/**
 * The one dialog.
 *
 * v1 had a 27-branch `if/else if` chain in `js/modal.js` rendering every dialog
 * in the app, mirrored by a second 27-way chain on the write side — and because
 * every field was read back out of the DOM by id at confirm time, any re-render
 * while a dialog was open destroyed whatever the user had typed. That is the
 * whole reason its background refresh was forbidden from re-rendering.
 *
 * Radix is already a dependency and was entirely unused. It brings the parts
 * that are tedious and easy to get wrong: focus trapping, restoring focus to
 * the trigger on close, `aria-modal` and labelling, Escape, scroll locking, and
 * an overlay that does not steal clicks from the content.
 *
 * `k-*` tokens throughout, so it inherits both themes without a second palette.
 */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  /** 640px for data-dense dialogs; 440px otherwise, matching v1's split. */
  wide,
  /** Blocks Escape and the overlay while a write is in flight. */
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  busy?: boolean;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RadixDialog.Content
          // A dialog that vanishes mid-save loses the user's work and leaves
          // them unable to tell whether the write landed.
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
          onInteractOutside={(e) => busy && e.preventDefault()}
          // Radix warns when Content has no Description, and its documented
          // opt-out is an explicit `aria-describedby={undefined}`. Spread only
          // in that case: when a description IS given, Radix wires the id
          // itself and passing the prop would override it back to nothing.
          //
          // The alternative — a visually-hidden Description repeating the
          // title — silences the warning by making a screen reader announce
          // the same words twice.
          {...(description ? {} : { "aria-describedby": undefined })}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[4px] border border-k-line bg-k-paper shadow-[var(--k-shadow-l)]"
          style={{ maxWidth: wide ? 640 : 440 }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-k-line px-4 py-3">
            <div className="min-w-0">
              <RadixDialog.Title className="k-card-title">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-0.5 text-[12px] text-k-mute">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              disabled={busy}
              className="k-btn k-btn-ghost k-btn-sm !px-1.5"
            >
              <X size={14} strokeWidth={1.5} />
            </RadixDialog.Close>
          </div>

          {/* Its own scroll container: a long form must not scroll the page
              behind it, and the footer stays reachable. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {children}
          </div>

          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-k-line px-4 py-3">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * Destructive confirmation.
 *
 * Every single-item delete in v1 went through a confirm step — except
 * `bulk-delete-integ`, where one click permanently removed N integrations with
 * no dialog at all. Bulk actions land in 15b; this exists first so there is no
 * excuse to skip it there.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel = "Delete",
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            className="k-btn k-btn-outline k-btn-sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="k-btn k-btn-sm text-white"
            style={{ background: "var(--k-banner-risk)" }}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[12.5px] text-k-ink-3">{body}</div>
    </Dialog>
  );
}
