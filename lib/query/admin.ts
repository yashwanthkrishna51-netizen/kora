"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "@/lib/api/fetcher";
import { keys } from "@/lib/query/keys";
import type { UserAdminView, UserOption } from "@/lib/db/queries/users";
import type { CapacityWeights } from "@/lib/db/queries/misc";
import type { ArchivedClient } from "@/lib/db/queries/clients";
import type { BackupArtifact } from "@/app/api/backups/route";

/**
 * The admin screen's data layer.
 *
 * Separate from `lib/query/mutations.ts` on purpose. That module's factory is
 * built around `EntityKind` — it patches a client tree in place, heals from a
 * 409's `current`, and invalidates `keys.clients.all`. Users, settings, audit
 * and backups are none of those things: they live outside the tree, three of
 * the four have no OCC token at all, and bending the factory to cover them
 * would make it worse at the job it exists for.
 *
 * So these are plain mutations against `keys.users.list()` and friends.
 */

/* ------------------------------------------------------------------ reads */

export interface AuditRow {
  id: number;
  ts: string;
  actorId: string | null;
  username: string | null;
  role: string | null;
  action: string;
  entity: string | null;
  screen: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditParams {
  from?: string;
  to?: string;
  user?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * One page of the audit log.
 *
 * The server returns `total` computed over the SAME filter, so paging needs no
 * second request — and the key carries the whole param object, so changing a
 * filter is a new cache entry rather than a mutation of the current one.
 *
 * `placeholderData` keeps the previous page on screen while the next loads.
 * Without it every page change blanks the table to a skeleton, which reads as
 * a reload rather than a step.
 */
export function useAudit(params: AuditParams): UseQueryResult<AuditPage> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") query.set(k, String(v));
  }
  const qs = query.toString();

  return useQuery({
    queryKey: keys.audit.page(params as Record<string, string | number | undefined>),
    queryFn: () => api<AuditPage>(`/api/audit${qs ? `?${qs}` : ""}`),
    placeholderData: (prev) => prev,
    // Append-only and read constantly while filtering; no point refetching a
    // page of history on the 60s interval.
    staleTime: 30_000,
    refetchInterval: false,
  });
}

export function useDigestRecipients(): UseQueryResult<string[]> {
  return useQuery({
    queryKey: keys.settings.digestRecipients(),
    queryFn: () =>
      api<{ digestRecipients: { emails: string[] } }>(
        "/api/settings/digest-recipients",
      ).then((r) => r.digestRecipients.emails),
    staleTime: 5 * 60_000,
  });
}

export function useBackups(): UseQueryResult<{
  backups: BackupArtifact[];
  bucket: string;
  error?: string;
}> {
  return useQuery({
    queryKey: ["backups"],
    queryFn: () =>
      api<{ backups: BackupArtifact[]; bucket: string; error?: string }>(
        "/api/backups",
      ),
    staleTime: 60_000,
    refetchInterval: false,
  });
}

export function useArchivedClients(): UseQueryResult<ArchivedClient[]> {
  return useQuery({
    queryKey: ["clients", "archived"],
    queryFn: () =>
      api<{ clients: ArchivedClient[] }>("/api/clients?archived=1").then(
        (r) => r.clients,
      ),
    staleTime: 60_000,
    refetchInterval: false,
  });
}

/** True when the server sent the admin shape. Narrowing, not casting. */
export function isAdminView(
  u: UserOption | UserAdminView,
): u is UserAdminView {
  return "lockedUntil" in u;
}

/**
 * Is this account locked RIGHT NOW?
 *
 * `lockedUntil` being set is not the answer. `checkLocked` treats an expired
 * timestamp as unlocked and deliberately leaves the column populated, so a row
 * locked yesterday still carries a value. Testing it for truthiness would show
 * a permanent padlock on anyone who ever got locked out once. v1 got this
 * right (`kora/js/admin.js:290`); it is an easy thing to get wrong.
 */
export function isLockedNow(u: UserAdminView, now = Date.now()): boolean {
  if (!u.lockedUntil) return false;
  const until = new Date(u.lockedUntil).getTime();
  return Number.isFinite(until) && until > now;
}

/* -------------------------------------------------------------- mutations */

/** Everything that changes a user invalidates the same one key. */
function useUsersInvalidator() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.users.all });
}

export interface UserRow {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  _v: string | null;
}

export function useCreateUser() {
  const invalidate = useUsersInvalidator();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<UserRow>("/api/users", { method: "POST", body, screen: "admin" }),
    onSuccess: invalidate,
  });
}

/**
 * Update a user. If-Match required, or the route answers 428.
 *
 * The token comes from the row the caller is editing rather than from a
 * refetch, so a role change racing someone else's edit surfaces as a 409
 * instead of silently overwriting it.
 */
export function useUpdateUser() {
  const invalidate = useUsersInvalidator();
  return useMutation({
    mutationFn: ({
      id,
      version,
      patch,
    }: {
      id: string;
      version: string | null;
      patch: Record<string, unknown>;
    }) =>
      api<UserRow>(`/api/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
        ifMatch: version ?? undefined,
        screen: "admin",
      }),
    onSuccess: invalidate,
  });
}

/** Delete a user. HARD delete — there is no archive and no undo. */
export function useDeleteUser() {
  const invalidate = useUsersInvalidator();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: string | null }) =>
      api<{ id: string }>(`/api/users/${encodeURIComponent(id)}`, {
        method: "DELETE",
        ifMatch: version ?? undefined,
        screen: "admin",
      }),
    onSuccess: invalidate,
  });
}

export interface ClearLockoutResult {
  username: string;
  networkLocksActive: number;
  networkLocksCleared: number;
  message: string;
}

/**
 * Clear an account lockout. Two-step by design.
 *
 * The first call sends no body and clears only the username axis. If per-IP
 * throttle locks are still active the response says so, and clearing THOSE is
 * opt-in — because `clearAllIpLocks` deletes every locked IP row in the table,
 * not this user's. The throttle is keyed by IP and has no idea who was trying
 * to sign in, so those rows are also the evidence of an attack in progress.
 */
export function useClearLockout() {
  const invalidate = useUsersInvalidator();
  return useMutation({
    mutationFn: ({
      id,
      clearNetworkLocks,
    }: {
      id: string;
      clearNetworkLocks?: boolean;
    }) =>
      api<ClearLockoutResult>(
        `/api/users/${encodeURIComponent(id)}/clear-lockout`,
        {
          method: "POST",
          body: clearNetworkLocks ? { clearNetworkLocks: true } : {},
          screen: "admin",
        },
      ),
    onSuccess: invalidate,
  });
}

export function useForceLogout() {
  return useMutation({
    mutationFn: (id: string) =>
      api<{ affected: number; username: string; message: string }>(
        `/api/users/${encodeURIComponent(id)}/force-logout`,
        { method: "POST", screen: "admin" },
      ),
  });
}

/**
 * Sign EVERYONE out, including the caller.
 *
 * The route clears the calling admin's own cookie, so the UI must navigate to
 * /login rather than carry on with a session the server has already revoked.
 * `token_version` is shared with the old app, so this signs people out of both
 * — which is exactly what it is for during the parallel-run freeze.
 */
export function useForceLogoutAll() {
  return useMutation({
    mutationFn: () =>
      api<{ affected: number; message: string }>("/api/auth/force-logout-all", {
        method: "POST",
        screen: "admin",
      }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: {
      currentPassword: string;
      newPassword?: string;
      email?: string;
    }) =>
      api<{ passwordChanged: boolean; message?: string }>(
        "/api/auth/change-password",
        { method: "POST", body, screen: "admin" },
      ),
  });
}

export function useSaveDigestRecipients() {
  const qc = useQueryClient();
  return useMutation({
    // Unwrapped to the array the caller actually wants, so the response and
    // the query hook have the same shape and callers cannot confuse the two.
    mutationFn: (emails: string[]) =>
      api<{ emails: string[] }>("/api/settings/digest-recipients", {
        method: "PUT",
        body: { emails },
        screen: "admin",
      }).then((r) => r.emails),
    // The server dedupes case-insensitively, so the stored list can be shorter
    // than the one sent. Seed the cache from the RESPONSE, not from the input.
    onSuccess: (stored) =>
      qc.setQueryData(keys.settings.digestRecipients(), stored),
  });
}

export function useSaveCapacityWeights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weights: CapacityWeights) =>
      api<CapacityWeights>("/api/settings/capacity-weights", {
        method: "PUT",
        body: weights,
        screen: "admin",
      }),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings.capacityWeights(), data);
      // The dashboard's team-bandwidth tile is computed from these.
      qc.invalidateQueries({ queryKey: keys.clients.all });
    },
  });
}

export function useRestoreClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) =>
      api<{ id: string; restored: Record<string, number> }>(
        `/api/clients/${encodeURIComponent(clientId)}/restore`,
        { method: "POST", screen: "admin" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.clients.all });
      qc.invalidateQueries({ queryKey: ["clients", "archived"] });
    },
  });
}
