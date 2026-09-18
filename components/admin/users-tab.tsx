"use client";

import { useState } from "react";
import { toast } from "sonner";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, ShieldAlert } from "lucide-react";
import { useUsers } from "@/lib/query/hooks";
import { useSession, isReadOnlyBuild } from "@/lib/query/permissions";
import { QueryState } from "@/components/ui/states";
import { ConfirmDialog } from "@/components/ui/dialog";
import { UserDialog } from "./user-dialog";
import { PasswordDialog } from "./password-dialog";
import { ViewAsCard } from "./view-as-card";
import { RecentAuditCard } from "./recent-audit-card";
import {
  isAdminView,
  isLockedNow,
  useDeleteUser,
  useClearLockout,
  useForceLogout,
  useForceLogoutAll,
} from "@/lib/query/admin";
import type { UserAdminView } from "@/lib/db/queries/users";
import { ApiError } from "@/lib/api/fetcher";
import { fmtDate, fmtDateTime } from "@/lib/utils/dates";

const ROLE_COLOR: Record<string, string> = {
  admin: "var(--k-primary)",
  editor: "var(--k-teal)",
  viewer: "var(--k-grey)",
};

function RolePill({ role }: { role: string }) {
  const color = ROLE_COLOR[role] ?? "var(--k-grey)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-k-line px-[9px] py-[3px] text-[11px] font-semibold"
      style={{ color }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
      {role}
    </span>
  );
}

/** Relative where it is useful, absolute where it is not. */
function lastActiveLabel(ts: string | null): string {
  if (!ts) return "never";
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms)) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  // `fmtDate`, not the first token of `fmtDateTime`. That produced
  // "03 Jul 2026, 02:45 pm".split(" ")[0] — a bare "03" — so a user dormant
  // for more than a month rendered as a number with no unit, sitting in a
  // column where every other row said "5d ago".
  return fmtDate(ts);
}

export function UsersTab() {
  const session = useSession();
  // Every control on this screen is a write, so read-only hides all of them
  // rather than letting an admin press one and collect a 423. The screen stays
  // useful: the table, the lockout state and the audit trail are all reads.
  const readOnly = isReadOnlyBuild();
  const query = useUsers();
  const users = (query.data ?? []).filter(isAdminView);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<UserAdminView | null>(null);
  const [deleting, setDeleting] = useState<UserAdminView | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  const del = useDeleteUser();
  const clearLockout = useClearLockout();
  const forceLogout = useForceLogout();
  const forceLogoutAll = useForceLogoutAll();

  const fail = (err: unknown, fallback: string) =>
    toast.error(err instanceof ApiError ? err.message : fallback);

  /**
   * Clear a lockout, then offer the second step if it is needed.
   *
   * The first call clears only the username axis. If IP throttle rows are still
   * active the server says so in `message`, and the follow-up is offered as a
   * toast action rather than performed automatically — `clearAllIpLocks`
   * deletes EVERY locked IP row in the table, not this user's, because the
   * throttle is keyed by IP and does not know who was signing in. Those rows
   * are also the evidence of an attack in progress.
   */
  function unlock(u: UserAdminView) {
    clearLockout.mutate(
      { id: u.id },
      {
        onSuccess(result) {
          const needsSecondStep =
            result.networkLocksActive > 0 && result.networkLocksCleared === 0;

          toast.success(result.message, {
            duration: needsSecondStep ? 12_000 : 4_000,
            action: needsSecondStep
              ? {
                  label: `Clear all ${result.networkLocksActive} network locks`,
                  onClick: () =>
                    clearLockout.mutate(
                      { id: u.id, clearNetworkLocks: true },
                      {
                        onSuccess: (r) => toast.success(r.message),
                        onError: (e) => fail(e, "Could not clear those."),
                      },
                    ),
                }
              : undefined,
          });
        },
        onError: (e) => fail(e, "Could not clear that lockout."),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="k-card overflow-hidden">
          <div className="k-card-head">
            <h2 className="k-card-title">Users</h2>
            {!readOnly && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="k-btn k-btn-outline k-btn-sm"
                  onClick={() => setChangingPassword(true)}
                >
                  My password
                </button>
                <button
                  type="button"
                  className="k-btn k-btn-primary k-btn-sm"
                  onClick={() => setAdding(true)}
                >
                  + User
                </button>
              </div>
            )}
          </div>

          <QueryState
            isPending={query.isPending}
            isPaused={query.isPaused}
            error={query.error}
            onRetry={() => query.refetch()}
            isEmpty={users.length === 0}
            skeletonRows={8}
          >
            <div role="table" aria-label="Users">
              <div
                role="row"
                className="k-thead grid items-center gap-3"
                style={{ gridTemplateColumns: "1fr 130px 96px 110px 34px" }}
              >
                <span role="columnheader">Name</span>
                <span role="columnheader">Username</span>
                <span role="columnheader">Role</span>
                <span role="columnheader">Last active</span>
                <span role="columnheader" className="sr-only">
                  Actions
                </span>
              </div>

              {users.map((u) => {
                const locked = isLockedNow(u);
                const isSelf = session?.username === u.username;
                return (
                  <div
                    key={u.id}
                    role="row"
                    className="grid items-center gap-3 border-b border-k-line-2 px-[18px] py-[11px] text-[12.5px] last:border-b-0"
                    style={{ gridTemplateColumns: "1fr 130px 96px 110px 34px" }}
                  >
                    <div
                      role="cell"
                      className="flex min-w-0 items-center gap-2.5"
                    >
                      <span
                        aria-hidden
                        className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full font-k-head text-[11px] font-bold"
                        style={
                          u.role === "admin"
                            ? {
                                background: "var(--k-primary)",
                                // Not #fff: on the dark theme's #7FC4E8 that
                                // is 1.87:1. The token inverts with the brand.
                                color: "var(--k-on-primary)",
                              }
                            : {
                                background: "var(--k-primary-08)",
                                color: "var(--k-primary)",
                              }
                        }
                      >
                        {u.name.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <span
                        className="truncate font-medium text-k-ink"
                        title={u.name}
                      >
                        {u.name}
                      </span>
                      {locked && (
                        <span
                          className="inline-flex flex-none items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            background: "var(--k-tint-risk)",
                            color: "var(--k-text-red)",
                          }}
                          title={`Locked until ${fmtDateTime(u.lockedUntil!)}${
                            u.lockoutLevel >= 2
                              ? " · next lock is 24 hours"
                              : ""
                          }`}
                        >
                          <ShieldAlert
                            size={11}
                            strokeWidth={1.5}
                            aria-hidden
                          />
                          Locked
                        </span>
                      )}
                    </div>

                    <span
                      role="cell"
                      className="k-mono truncate text-[11px] text-k-mute"
                    >
                      {u.username}
                    </span>

                    <span role="cell">
                      <RolePill role={u.role} />
                    </span>

                    <span
                      role="cell"
                      className="text-[11.5px] text-k-mute-2"
                      title={
                        u.lastActive ? fmtDateTime(u.lastActive) : undefined
                      }
                    >
                      {lastActiveLabel(u.lastActive)}
                    </span>

                    <span role="cell" className="text-right">
                      {!readOnly && (
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <button
                              type="button"
                              className="k-btn k-btn-ghost h-7 w-7 justify-center p-0"
                              aria-label={`Actions for ${u.username}`}
                            >
                              <MoreHorizontal
                                size={15}
                                strokeWidth={1.5}
                                aria-hidden
                              />
                            </button>
                          </Menu.Trigger>
                          <Menu.Portal>
                            <Menu.Content
                              align="end"
                              sideOffset={4}
                              className="z-50 min-w-[210px] rounded-k border border-k-line bg-k-paper p-1 shadow-[var(--k-shadow-m)]"
                            >
                              <Menu.Item
                                className="k-menu-item"
                                onSelect={() => setEditing(u)}
                              >
                                Edit
                              </Menu.Item>
                              {locked && (
                                <Menu.Item
                                  className="k-menu-item"
                                  onSelect={() => unlock(u)}
                                >
                                  Clear lockout
                                </Menu.Item>
                              )}
                              <Menu.Item
                                className="k-menu-item"
                                onSelect={() =>
                                  forceLogout.mutate(u.id, {
                                    onSuccess: (r) => toast.success(r.message),
                                    onError: (e) =>
                                      fail(e, "Could not sign them out."),
                                  })
                                }
                              >
                                Sign out everywhere
                              </Menu.Item>

                              <Menu.Separator className="my-1 h-px bg-k-line-2" />

                              <Menu.Item
                                className="k-menu-item k-menu-item-danger"
                                disabled={isSelf}
                                onSelect={() => setDeleting(u)}
                              >
                                {isSelf ? "Delete (not yourself)" : "Delete"}
                              </Menu.Item>
                            </Menu.Content>
                          </Menu.Portal>
                        </Menu.Root>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </QueryState>
        </div>

        {/* The freeze control. Below the table and visually quiet, because it
            is a cutover tool rather than a daily one. */}
        {!readOnly && (
          <div className="k-callout mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[12.5px] font-semibold text-k-ink">
                  Sign everyone out
                </div>
                <p className="mt-0.5 text-[11.5px] leading-[1.5] text-k-mute">
                  Revokes every session in one statement — including yours, and
                  including the old Kora, which shares the same token version.
                </p>
              </div>
              <button
                type="button"
                className="k-btn k-btn-outline k-btn-sm flex-none"
                onClick={() => setLoggingOutAll(true)}
              >
                Sign everyone out
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-[320px] lg:flex-none">
        <ViewAsCard />
        <RecentAuditCard />
      </div>

      {adding && (
        <UserDialog open onOpenChange={(o) => !o && setAdding(false)} />
      )}
      {editing && (
        <UserDialog
          open
          editing={editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      <PasswordDialog
        open={changingPassword}
        onOpenChange={setChangingPassword}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.username ?? ""}?`}
        body={
          <>
            This removes the account permanently — users are hard-deleted, not
            archived, so there is no undo. Their audit history stays.
          </>
        }
        confirmLabel="Delete user"
        busy={del.isPending}
        onConfirm={() => {
          if (!deleting) return;
          del.mutate(
            { id: deleting.id, version: deleting._v },
            {
              onSuccess() {
                toast.success(`Deleted ${deleting.username}.`);
                setDeleting(null);
              },
              onError: (e) => fail(e, "Could not delete that user."),
            },
          );
        }}
      />

      <ConfirmDialog
        open={loggingOutAll}
        onOpenChange={setLoggingOutAll}
        title="Sign everyone out?"
        body={
          <>
            Every signed-in person, on both the new and the old Kora, will have
            to sign in again — <strong>including you, immediately</strong>. Any
            unsaved work in someone else&rsquo;s open tab is lost.
          </>
        }
        confirmLabel="Sign everyone out"
        busy={forceLogoutAll.isPending}
        onConfirm={() =>
          forceLogoutAll.mutate(undefined, {
            onSuccess() {
              // A HARD navigation, deliberately, against the lint's advice.
              // The route has already cleared this browser's cookie and bumped
              // every token_version, so the React Query cache, the
              // SessionProvider value and any open dialog now describe a
              // session that no longer exists. router.push() would carry all
              // of that across; a full load is the only way to guarantee the
              // next screen is built from nothing.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.href = "/login";
            },
            onError: (e) => fail(e, "Could not sign everyone out."),
          })
        }
      />
    </div>
  );
}
