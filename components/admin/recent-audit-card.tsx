"use client";

import { useAudit } from "@/lib/query/admin";
import { fmtDateTime } from "@/lib/utils/dates";

/**
 * The last few audit events, beside the users table.
 *
 * Shares `keys.audit.page` with the Audit tab, so the six rows here and the
 * first page there are one cache entry when the filters happen to match — and
 * distinct entries when they do not, because the key carries the whole param
 * object.
 *
 * Rows written by a cron carry `username: null`; they are shown as "System"
 * rather than blank, matching the artboard's sample data.
 */
export function RecentAuditCard({ onViewAll }: { onViewAll?: () => void }) {
  const { data, isPending, error } = useAudit({ limit: 6 });
  const rows = data?.rows ?? [];

  return (
    <div className="k-card overflow-hidden">
      <div className="border-b border-k-line-2 px-[18px] py-[14px]">
        <h2 className="k-card-title">Recent activity</h2>
      </div>

      {isPending && <div className="k-skeleton m-[18px] h-24" />}

      {error && (
        <p className="px-[18px] py-4 text-[11.5px] text-k-mute">
          Could not load recent activity.
        </p>
      )}

      {!isPending && !error && rows.length === 0 && (
        <p className="px-[18px] py-4 text-[11.5px] text-k-mute">
          Nothing logged yet.
        </p>
      )}

      {rows.map((r) => (
        <div key={r.id} className="border-b border-k-line-2 px-[18px] py-2.5 last:border-b-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] font-semibold text-k-ink">
              {r.username ?? "System"}
            </span>
            <span className="k-mono ml-auto flex-none text-[10px] text-k-mute-2">
              {fmtDateTime(r.ts)}
            </span>
          </div>
          <div className="mt-0.5 text-[11.5px] leading-[1.45] text-k-mute">
            {r.action}
          </div>
        </div>
      ))}

      {onViewAll && rows.length > 0 && (
        <button
          type="button"
          className="k-btn k-btn-link w-full justify-start px-[18px] py-[11px] text-[11.5px] font-semibold"
          onClick={onViewAll}
        >
          View full log →
        </button>
      )}
    </div>
  );
}
