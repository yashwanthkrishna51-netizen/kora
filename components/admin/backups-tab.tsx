"use client";

import { toast } from "sonner";
import { Archive, RotateCcw } from "lucide-react";
import {
  useBackups,
  useArchivedClients,
  useRestoreClient,
} from "@/lib/query/admin";
import { QueryState } from "@/components/ui/states";
import { isReadOnlyBuild } from "@/lib/query/permissions";
import { fmtDateTime } from "@/lib/utils/dates";
import { ApiError } from "@/lib/api/fetcher";

function bytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupsTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <BackupsCard />
      <ArchivedClientsCard />
    </div>
  );
}

/**
 * What the nightly cron has actually written.
 *
 * Deliberately a list of artifacts rather than a green tick. `/api/health`
 * already reports that storage credentials work — and they do, while
 * `kora-backups` has been EMPTY since it was created, because the cron has
 * never once succeeded. "Configured" and "ran" are different claims and only
 * the second one would help you at 2am.
 *
 * No download links. These objects are a full database dump; handing an admin
 * session a signed URL would turn it into a data export. Retrieval stays a
 * Supabase-console operation, which has its own audit trail.
 */
function BackupsCard() {
  const query = useBackups();
  const backups = query.data?.backups ?? [];
  const storageError = query.data?.error;

  return (
    <div className="k-card overflow-hidden">
      <div className="border-b border-k-line-2 px-[18px] py-[14px]">
        <h2 className="k-card-title">Backups</h2>
        <p className="mt-1 text-[11.5px] text-k-mute">
          Written nightly to{" "}
          <span className="k-mono">{query.data?.bucket ?? "kora-backups"}</span>{" "}
          · password hashes excluded
        </p>
      </div>

      <QueryState
        isPending={query.isPending}
        isPaused={query.isPaused}
        error={query.error}
        onRetry={() => query.refetch()}
        skeletonRows={5}
      >
        {storageError ? (
          <div className="px-[18px] py-4">
            <p className="text-[12.5px] font-semibold text-k-text-red">
              Storage did not answer
            </p>
            <p className="mt-1 text-[11.5px] leading-[1.55] text-k-mute">
              {storageError}
            </p>
          </div>
        ) : backups.length === 0 ? (
          <div className="px-[18px] py-4">
            <p className="text-[12.5px] font-semibold text-k-ink">
              No backups yet
            </p>
            <p className="mt-1 text-[11.5px] leading-[1.55] text-k-mute">
              The bucket exists and is readable, but nothing has been written to
              it — so the nightly job has not completed successfully. Worth
              fixing before the new app carries real work.
            </p>
          </div>
        ) : (
          backups.map((b) => (
            <div
              key={b.path}
              className="flex items-center gap-3 border-b border-k-line-2 px-[18px] py-2.5 last:border-b-0"
            >
              <Archive
                size={15}
                strokeWidth={1.5}
                aria-hidden
                className="flex-none text-k-mute-2"
              />
              <span className="k-mono min-w-0 flex-1 truncate text-[11.5px] text-k-ink">
                {b.name}
              </span>
              <span className="k-mono flex-none text-[11px] text-k-mute-2">
                {bytes(b.bytes)}
              </span>
              <span className="k-mono flex-none text-[10.5px] text-k-mute-2">
                {b.createdAt ? fmtDateTime(b.createdAt) : "—"}
              </span>
            </div>
          ))
        )}
      </QueryState>
    </div>
  );
}

/**
 * Archived clients, and the way back.
 *
 * `POST /api/clients/[clientId]/restore` has existed since step 11 and has been
 * unreachable the whole time — not because the button was missing, but because
 * nothing could tell you which clients were archived. Soft delete without a
 * list is delete with extra steps.
 *
 * `nameTaken` is computed server-side: migration 0004's unique index covers
 * active rows only, so a name freed by archiving can be taken by a new client,
 * and the restore is then refused. Better to disable the button with a reason
 * than to fail on click.
 */
function ArchivedClientsCard() {
  const readOnly = isReadOnlyBuild();
  const query = useArchivedClients();
  const restore = useRestoreClient();
  const rows = query.data ?? [];

  return (
    <div className="k-card overflow-hidden">
      <div className="border-b border-k-line-2 px-[18px] py-[14px]">
        <h2 className="k-card-title">Archived clients</h2>
        <p className="mt-1 text-[11.5px] text-k-mute">
          Restoring brings back the client and everything under it.
        </p>
      </div>

      <QueryState
        isPending={query.isPending}
        isPaused={query.isPaused}
        error={query.error}
        onRetry={() => query.refetch()}
        skeletonRows={4}
      >
        {rows.length === 0 ? (
          <p className="px-[18px] py-4 text-[11.5px] text-k-mute">
            Nothing archived.
          </p>
        ) : (
          rows.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 border-b border-k-line-2 px-[18px] py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-k-ink">
                  {c.name}
                </div>
                <div className="mt-0.5 text-[11px] text-k-mute-2">
                  {c.archivedBy ? `by ${c.archivedBy}` : "archived"}
                  {c.archivedAt ? ` · ${fmtDateTime(c.archivedAt)}` : ""}
                  {c.nameTaken && (
                    <span className="text-k-text-amber">
                      {" "}
                      · a live client already uses this name
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="k-btn k-btn-outline k-btn-sm flex-none"
                disabled={readOnly || c.nameTaken || restore.isPending}
                title={
                  readOnly
                    ? "Kora is read-only right now."
                    : c.nameTaken
                      ? "Rename the live client first, or this restore will be refused."
                      : undefined
                }
                onClick={() =>
                  restore.mutate(c.id, {
                    onSuccess(r) {
                      const n = Object.values(r.restored).reduce(
                        (a, b) => a + b,
                        0,
                      );
                      toast.success(`Restored ${c.name} — ${n} rows.`);
                    },
                    onError: (err) =>
                      toast.error(
                        err instanceof ApiError
                          ? err.message
                          : "Could not restore that.",
                      ),
                  })
                }
              >
                <RotateCcw size={13} strokeWidth={1.5} aria-hidden />
                Restore
              </button>
            </div>
          ))
        )}
      </QueryState>
    </div>
  );
}
