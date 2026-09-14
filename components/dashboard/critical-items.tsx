"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/states";
import type { CriticalItem } from "@/lib/domain/dashboard";

/**
 * The critical-items list — the union of overdue integrations, at-risk phases
 * and open L3/L4 tickets, worst first.
 *
 * Shared by both dashboards, because it is the same question at two scopes:
 * the admin sees the portfolio, an editor sees their own name. That is the ONLY
 * difference between them, so filtering happens at the call site and this
 * renders whatever it is given — including the domain filter artboard 1b draws
 * as chips, which lives in the card head next to the title.
 *
 * Severity 0 (overdue, L4) is marked; severity 1 (stale, L3) is not. The order
 * already encodes it, but a list where everything looks equally urgent is a
 * list nobody triages.
 *
 * TWO SHAPES. `table` is 1b's four columns, for the full-width admin card.
 * `list` is the original stacked row and stays the default, because the same
 * component fills a third-width card on the editor dashboard (artboard 1l)
 * where four columns do not fit — and 1l is not being reskinned here.
 */
export function CriticalItems({
  items,
  limit = 8,
  emptyTitle = "Nothing needs attention",
  emptyHint,
  variant = "list",
}: {
  items: CriticalItem[];
  limit?: number;
  emptyTitle?: string;
  emptyHint?: string;
  variant?: "list" | "table";
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  const shown = items.slice(0, limit);

  if (variant === "table") {
    return (
      <>
        {/* 1180px, NOT md — and not `xl` either.
            Tailwind breakpoints measure the VIEWPORT, but this grid lives in a
            column 288px narrower than it. At a 768px viewport the dashboard
            column is ~448px against 576px of fixed columns and gaps, so `1fr`
            collapsed to zero and the row overflowed between roughly 768 and
            950 — a bug this variant shipped with.
            1180 rather than xl's 1280 because 1180 is the artboard's own width:
            at exactly that viewport the column is 892px, which is the measure
            everything here was drawn against. Below it the row falls back to
            the stacked list, which is what that variant is for. */}
        <div className="k-thead-plain hidden grid-cols-[1fr_200px_160px_180px] page:grid">
          <div>Item</div>
          <div>Client</div>
          <div>Status / age</div>
          <div>Owner</div>
        </div>
        <ul>
          {shown.map((item, i) => (
            <li
              key={`${item.clientId}-${item.title}-${i}`}
              className="grid grid-cols-1 items-center gap-x-3 border-b border-l-[3px] border-b-k-line-2 px-[15px] py-2.5 text-[12.5px] last:border-b-0 page:grid-cols-[1fr_200px_160px_180px]"
              style={{ borderLeftColor: severityFill(item.severity) }}
            >
              <div className="min-w-0">
                <Link
                  href={hrefFor(item)}
                  className="block truncate font-semibold text-k-ink hover:text-k-primary hover:underline"
                >
                  {item.title}
                </Link>
                <p className="mt-0.5 truncate text-[10.5px] text-k-mute-2">
                  {item.domain}
                </p>
              </div>
              <div className="min-w-0 truncate text-k-ink-3">{item.client}</div>
              <div
                className="k-mono truncate text-[11.5px] font-medium"
                style={{ color: severityText(item.severity) }}
              >
                {item.detail}
              </div>
              <div className="min-w-0 truncate text-k-mute">
                {item.owner || "—"}
              </div>
            </li>
          ))}
        </ul>
        <Overflow shown={shown.length} total={items.length} inset />
      </>
    );
  }

  return (
    <>
      <ul className="divide-y divide-k-line-2">
        {shown.map((item, i) => (
          <li
            key={`${item.clientId}-${item.title}-${i}`}
            className="py-2.5 first:pt-0"
          >
            <div className="flex items-start gap-2">
              {item.severity === 0 && (
                <AlertTriangle
                  size={13}
                  strokeWidth={1.5}
                  aria-label="Highest severity"
                  className="mt-0.5 shrink-0 text-k-text-red"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-k-ink">
                  <Link
                    href={hrefFor(item)}
                    className="hover:text-k-primary hover:underline"
                  >
                    {item.title}
                  </Link>
                </p>
                <p className="mt-0.5 text-[11.5px] text-k-mute">
                  {item.client} · {item.detail}
                  {item.owner && <> · {item.owner}</>}
                </p>
              </div>
              <span className="k-tag shrink-0 text-[10px]">{item.domain}</span>
            </div>
          </li>
        ))}
      </ul>
      <Overflow shown={shown.length} total={items.length} />
    </>
  );
}

function Overflow({
  shown,
  total,
  inset,
}: {
  shown: number;
  total: number;
  inset?: boolean;
}) {
  if (total <= shown) return null;
  return (
    <p
      className={`text-[11px] text-k-mute ${inset ? "px-[18px] py-2.5" : "mt-2.5"}`}
    >
      {total - shown} more not shown
    </p>
  );
}

/** Severity 0 is overdue or L4; 1 is stale or L3. Fills, for the left rule. */
function severityFill(severity: number): string {
  return severity === 0 ? "var(--k-fill-risk)" : "var(--k-fill-warn)";
}

/** The text-safe pair of the same hue, for the age cell. Never the fill. */
function severityText(severity: number): string {
  return severity === 0 ? "var(--k-text-red)" : "var(--k-text-amber)";
}

/**
 * Where an item links to.
 *
 * An integration goes to its record; everything else goes to the client's own
 * screen for that domain, because a phase or an AMS entry has no URL of its own
 * that would land you usefully.
 *
 * MATCHED AGAINST THE VALUES `buildCriticalItems` ACTUALLY WRITES. It emits
 * `"Phase"` and `` `AMS · L4` `` (lib/domain/dashboard.ts:148,163), never
 * `"Implementation"` and never a bare `"AMS"` — so the two checks here used to
 * match nothing, and every at-risk phase and every L4 ticket fell through to
 * the integrations fallback. Clicking a critical phase took you to the wrong
 * tracker.
 */
function hrefFor(item: CriticalItem): string {
  if (item.integId) {
    return `/integrations/${item.clientId}/${encodeURIComponent(item.integId)}`;
  }
  if (item.domain === "Phase") return `/implementation/${item.clientId}`;
  if (item.domain.startsWith("AMS")) return `/ams/${item.clientId}`;
  return `/integrations/${item.clientId}`;
}

/** The chip buckets artboard 1b draws, matched against those same values. */
export function criticalDomainOf(
  item: CriticalItem,
): "Integration" | "Phase" | "AMS" {
  if (item.domain === "Phase") return "Phase";
  if (item.domain.startsWith("AMS")) return "AMS";
  return "Integration";
}
