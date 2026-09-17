"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useArchiveEntity, isConflict } from "@/lib/query/mutations";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api/fetcher";

/**
 * Archiving one record.
 *
 * SOFT DELETE. The row is flagged `archived = true` and stays in the database
 * forever; the application simply never selects it again. v1 issued a real
 * DELETE, which is why recovering from its data-loss incident needed a backup
 * restore.
 *
 * NO UNDO, AND IT SAYS SO. v1 offered a five-second undo on three of its ten
 * delete actions, implemented as a second write that spliced the object back —
 * and `execUndo` did not await it, so "Restored ✓" appeared before the write
 * resolved and a failure was swallowed entirely. Here the honest position is
 * that undo is not available: `restoreClient` is the only restore endpoint that
 * exists, and it is admin-only, so integrations, milestones and work-log
 * entries genuinely cannot be brought back through the API. An undo button that
 * re-created the row would give it a new id and silently orphan everything
 * referencing the old one.
 *
 * So the dialog states the consequence, including the cascade, and an admin can
 * still recover the row directly in the database because nothing was destroyed.
 */
export function ArchiveButton({
  path,
  version,
  label,
  /** What else goes with it, if anything. */
  cascade,
  onArchived,
  screen,
}: {
  path: string;
  version: string | undefined;
  /** The record's name, so the dialog names what is about to go. */
  label: string;
  cascade?: string;
  onArchived?: () => void;
  screen?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  const archive = useArchiveEntity({ path, screen });

  return (
    <>
      <button
        type="button"
        aria-label={`Archive ${label}`}
        title={version ? `Archive ${label}` : "Reload before archiving this"}
        disabled={!version || archive.isPending}
        onClick={() => setConfirming(true)}
        className="k-btn k-btn-ghost k-btn-sm !px-1.5 hover:!text-k-text-red"
      >
        <Trash2 size={13} strokeWidth={1.5} />
      </button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Archive "${label}"?`}
        confirmLabel="Archive"
        busy={archive.isPending}
        body={
          <>
            <p>
              It disappears from every screen immediately.
              {cascade ? ` ${cascade}` : ""}
            </p>
            <p className="mt-2 text-k-mute">
              There is no undo in the app. Nothing is destroyed — the record is
              flagged rather than deleted — so an administrator can recover it
              from the database if this was a mistake.
            </p>
          </>
        }
        onConfirm={() => {
          if (!version) return;
          archive.mutate(version, {
            onSuccess() {
              setConfirming(false);
              toast.success(`Archived "${label}".`);
              onArchived?.();
            },
            onError(err) {
              setConfirming(false);
              toast.error(
                isConflict(err)
                  ? "Someone changed this while you were deleting it. Reload and try again."
                  : err instanceof ApiError
                    ? err.message
                    : "Could not archive that.",
              );
            },
          });
        }}
      />
    </>
  );
}
