"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAudit, type AuditParams, type AuditPage } from "@/lib/query/admin";
import { api } from "@/lib/api/fetcher";
import { ExportMenu } from "@/components/export-menu";
import { useUsers } from "@/lib/query/hooks";
import { QueryState } from "@/components/ui/states";
import { fmtDateTime } from "@/lib/utils/dates";

const PAGE_SIZE = 50;

/**
 * The server clamps `limit` to 200, so that is the most one export can carry.
 * Said out loud in the menu label and again in the toast when it truncates —
 * an export that silently stops at 200 rows reads as a complete record.
 */
const EXPORT_MAX = 200;

/** Midnight N days ago, as the ISO string the route compares against. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * The presets v1 had, rebuilt as chips.
 *
 * Note `q` filters the ACTION COLUMN ONLY, with `ilike` — so "All deletes"
 * matches how actions are worded ("Delete client X", "Archive …"), not an
 * entity type. There is no entity filter on the route, and pretending otherwise
 * in the UI would return confidently wrong results.
 */
const PRESETS: { id: string; label: string; params: AuditParams }[] = [
  { id: "24h", label: "Last 24 hours", params: { from: daysAgo(1) } },
  { id: "7d", label: "Last 7 days", params: { from: daysAgo(7) } },
  { id: "deletes", label: "Deletes", params: { q: "delete" } },
  { id: "logins", label: "Logins", params: { q: "login" } },
  { id: "failures", label: "Failed logins", params: { q: "login failed" } },
];

export function AuditTab() {
  const [preset, setPreset] = useState<string | null>(null);
  const [user, setUser] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);

  const params: AuditParams = {
    ...(PRESETS.find((p) => p.id === preset)?.params ?? {}),
    ...(user ? { user } : {}),
    // A typed search wins over a preset's canned one — the preset is a starting
    // point, not a lock.
    ...(q ? { q } : {}),
    limit: PAGE_SIZE,
    offset,
  };

  const query = useAudit(params);
  const usersQuery = useUsers();
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Any filter change resets to page one; staying on page 9 of a new filter
      shows an empty table that looks like a bug. */
  const change = (fn: () => void) => {
    fn();
    setOffset(0);
  };

  return (
    <div className="k-card overflow-hidden">
      <div className="k-card-head flex-wrap gap-3">
        <h2 className="k-card-title">Audit log</h2>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu
            label="Export"
            items={[
              {
                label: `Excel (this filter, up to ${EXPORT_MAX})`,
                disabledReason: total === 0 ? "nothing to export" : undefined,
                run: async () => {
                  // Re-fetches with the SAME filter rather than exporting the
                  // 50 rows on screen. v1 did the same, and the alternative —
                  // exporting one page — is the kind of thing nobody notices
                  // until an audit request comes back short.
                  const query = new URLSearchParams();
                  for (const [k, v] of Object.entries({ ...params, limit: EXPORT_MAX, offset: 0 })) {
                    if (v !== undefined && v !== "") query.set(k, String(v));
                  }
                  const page = await api<AuditPage>(`/api/audit?${query}`);
                  const { exportAuditExcel } = await import("@/lib/export/excel");
                  await exportAuditExcel(page.rows);
                  toast.success(
                    page.total > page.rows.length
                      ? `Exported ${page.rows.length} of ${page.total} events — narrow the filter for the rest.`
                      : `Exported ${page.rows.length} events.`,
                  );
                },
              },
            ]}
          />
          <select
            className="k-select k-input-sm w-[150px]"
            value={user}
            aria-label="Filter by user"
            onChange={(e) => change(() => setUser(e.target.value))}
          >
            <option value="">Everyone</option>
            {(usersQuery.data ?? []).map((u) => (
              <option key={u.id} value={u.username}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            className="k-input k-input-sm w-[180px]"
            placeholder="Search actions…"
            aria-label="Search actions"
            value={q}
            onChange={(e) => change(() => setQ(e.target.value))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-k-line-2 px-[18px] py-3">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="k-chip k-chip-sm"
            data-active={preset === p.id}
            onClick={() =>
              change(() => setPreset(preset === p.id ? null : p.id))
            }
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto text-[11.5px] text-k-mute-2">
          {total.toLocaleString()} {total === 1 ? "event" : "events"}
        </span>
      </div>

      <QueryState
        isPending={query.isPending}
        isPaused={query.isPaused}
        error={query.error}
        onRetry={() => query.refetch()}
        isEmpty={rows.length === 0}
        skeletonRows={10}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead>
              <tr className="k-thead-plain [&>th]:px-[18px] [&>th]:py-2 [&>th]:text-left">
                <th className="w-[150px]">When</th>
                <th className="w-[130px]">Who</th>
                <th>Action</th>
                <th className="w-[110px]">Screen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-k-line-2 last:border-b-0">
                  <td className="k-mono px-[18px] py-2.5 text-[11px] whitespace-nowrap text-k-mute">
                    {fmtDateTime(r.ts)}
                  </td>
                  <td className="px-[18px] py-2.5">
                    <span className="font-medium text-k-ink">
                      {r.username ?? "System"}
                    </span>
                    {r.role && (
                      <span className="ml-1.5 text-[10.5px] text-k-mute-2">
                        {r.role}
                      </span>
                    )}
                  </td>
                  <td className="px-[18px] py-2.5 text-k-ink-3">{r.action}</td>
                  <td className="px-[18px] py-2.5 text-[11.5px] text-k-mute">
                    {r.screen ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      <div className="flex items-center justify-between gap-3 border-t border-k-line-2 px-[18px] py-3">
        <button
          type="button"
          className="k-btn k-btn-outline k-btn-sm"
          disabled={offset === 0 || query.isFetching}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          ← Prev
        </button>
        <span className="k-mono text-[11.5px] text-k-mute">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="k-btn k-btn-outline k-btn-sm"
          disabled={offset + PAGE_SIZE >= total || query.isFetching}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
