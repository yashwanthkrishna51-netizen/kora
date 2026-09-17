"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useClientList } from "@/lib/query/hooks";
import { isReadOnlyBuild } from "@/lib/query/permissions";
import { keys } from "@/lib/query/keys";
import { api } from "@/lib/api/fetcher";
import { ExportMenu } from "@/components/export-menu";
import { useUpdateEntity } from "@/lib/query/mutations";
import { QueryState } from "@/components/ui/states";
import { InlineText } from "@/components/ui/inline";
import type { ClientSummary, ClientTree } from "@/lib/db/queries/clients";
import { ApiError } from "@/lib/api/fetcher";

type DomainId = "all" | "integrations" | "implementation" | "ams";

const DOMAINS: { id: DomainId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "integrations", label: "Integrations" },
  { id: "implementation", label: "Implementation" },
  { id: "ams", label: "AMS & Support" },
];

/**
 * Clients — one table, replacing v1's three.
 *
 * `js/admin.js` had an Integrations tab, an Implementations tab and an AMS tab
 * that were the same table with one column swapped and a different filter. The
 * handoff drops all three; this keeps what they could do — rename, remove from
 * a domain, and see the per-domain roll-up — behind filter chips instead.
 *
 * Domain membership is read from `hasImplementation` / `hasAms`, NEVER from
 * v1's `modules === undefined` sentinel. That sentinel is exactly what
 * migration 0003 exists to replace, and six production clients would vanish
 * from these filters if this used counts instead of flags: a client can be in
 * a domain with nothing in it yet.
 */
export function ClientsTab() {
  const qc = useQueryClient();
  const query = useClientList();
  const [domain, setDomain] = useState<DomainId>("all");
  const [search, setSearch] = useState("");
  const all = useMemo(() => query.data ?? [], [query.data]);

  const inDomain = (c: ClientSummary, d: DomainId) =>
    d === "all" ||
    (d === "implementation" && c.hasImplementation) ||
    (d === "ams" && c.hasAms) ||
    // Integrations has no membership flag — every client may hold them, so
    // presence is the only signal there is.
    (d === "integrations" && c.counts.integrations > 0);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (c) => inDomain(c, domain) && (!q || c.name.toLowerCase().includes(q)),
    );
  }, [all, domain, search]);

  const totals = useMemo(
    () => ({
      clients: rows.length,
      integrations: rows.reduce((a, c) => a + c.counts.integrations, 0),
      modules: rows.reduce((a, c) => a + c.counts.modules, 0),
      workLog: rows.reduce((a, c) => a + c.counts.workLog, 0),
    }),
    [rows],
  );

  return (
    <div className="k-card overflow-hidden">
      <div className="k-card-head flex-wrap gap-3">
        <h2 className="k-card-title">Clients</h2>
        <input
          className="k-input k-input-sm w-full max-w-[220px]"
          placeholder="Search clients…"
          aria-label="Search clients"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-k-line-2 px-[18px] py-3">
        {DOMAINS.map((d) => (
          <button
            key={d.id}
            type="button"
            className="k-chip k-chip-sm"
            data-active={domain === d.id}
            onClick={() => setDomain(d.id)}
          >
            {d.label}
          </button>
        ))}
        <span className="ml-auto text-[11.5px] text-k-mute-2">
          {rows.length} of {all.length} shown
        </span>
        <ExportMenu
          label="Export"
          items={(["integrations", "impl", "ams"] as const).map((d) => ({
            label: `Excel (${d === "impl" ? "Implementation" : d === "ams" ? "AMS" : "Integrations"})`,
            run: async () => {
              // Fetched on CLICK, not held by the tab. The roll-up columns —
              // at-risk counts, phase progress, total hours — are computed from
              // the children, and `ClientSummary` carries only counts. Loading
              // 702 phases on every admin visit to render a button nobody may
              // press is the wrong trade; `fetchQuery` reuses the cache when
              // the dashboard has already populated it.
              const trees = await qc.fetchQuery<ClientTree[]>({
                queryKey: keys.clients.tree(),
                queryFn: () =>
                  api<{ clients: ClientTree[] }>("/api/clients?view=tree").then(
                    (r) => r.clients,
                  ),
              });
              const { exportAdminTableExcel } = await import("@/lib/export/excel");
              await exportAdminTableExcel(d, trees);
              toast.success("Spreadsheet downloaded.");
            },
          }))}
        />
      </div>

      {/* Roll-up over what is currently filtered, not over everything — the
          number under a chip should describe the chip. */}
      <div className="grid grid-cols-2 gap-px border-b border-k-line-2 bg-k-line-2 sm:grid-cols-4">
        {[
          ["Clients", totals.clients],
          ["Integrations", totals.integrations],
          ["Modules", totals.modules],
          ["Work-log entries", totals.workLog],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-k-paper px-[18px] py-3">
            <div className="k-num text-[20px] leading-none">{value as number}</div>
            <div className="k-eyebrow mt-1.5">{label as string}</div>
          </div>
        ))}
      </div>

      <QueryState
        isPending={query.isPending}
        isPaused={query.isPaused}
        error={query.error}
        onRetry={() => query.refetch()}
        isEmpty={rows.length === 0}
        skeletonRows={8}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-[12.5px]">
            <thead>
              <tr className="k-thead-plain [&>th]:px-[18px] [&>th]:py-2 [&>th]:text-left">
                <th>Client</th>
                <th className="w-[110px]">Domains</th>
                <th className="w-[90px] text-right">Integ.</th>
                <th className="w-[90px] text-right">Modules</th>
                <th className="w-[90px] text-right">Work log</th>
                <th className="w-[44px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <ClientRow key={c.id} client={c} />
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </div>
  );
}

/**
 * One row, with its own mutation.
 *
 * `useUpdateEntity` binds to a single entity by id, so the domain toggle cannot
 * live on the table — one hook per row is the shape the mutation layer wants,
 * and it means a failed toggle rolls back only its own row.
 */
function ClientRow({ client: c }: { client: ClientSummary }) {
  const readOnly = isReadOnlyBuild();
  const update = useUpdateEntity("client", c.id, c.id, {
    path: `/api/clients/${encodeURIComponent(c.id)}`,
    screen: "admin",
    onFailure: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Could not change that.",
      ),
  });

  const setDomainFlag = (which: "implementation" | "ams", value: boolean) => {
    const label = which === "ams" ? "AMS" : "Implementation";
    update.mutate(
      {
        version: c._v,
        patch:
          which === "implementation"
            ? { hasImplementation: value }
            : { hasAms: value },
      },
      {
        onSuccess: () =>
          toast.success(
            value
              ? `${c.name} added to ${label}.`
              : `${c.name} removed from ${label}.`,
          ),
      },
    );
  };

  return (
    <tr className="border-b border-k-line-2 last:border-b-0">
                  <td className="px-[18px] py-2">
                    {readOnly ? (
                      <span className="text-[12.5px] font-medium text-k-ink">{c.name}</span>
                    ) : (
                    <InlineText
                      target={{
                        kind: "client",
                        clientId: c.id,
                        id: c.id,
                        path: `/api/clients/${encodeURIComponent(c.id)}`,
                        screen: "admin",
                      }}
                      field="name"
                      value={c.name}
                      version={c._v}
                      before={c as unknown as Record<string, unknown>}
                      label={`Rename ${c.name}`}
                    />
                    )}
                  </td>
                  <td className="px-[18px] py-2">
                    <div className="flex gap-1">
                      {c.hasImplementation && (
                        <span className="k-tag" style={{ background: "var(--k-tint-sky)", color: "var(--k-text-sky)" }}>
                          IMPL
                        </span>
                      )}
                      {c.hasAms && (
                        <span className="k-tag" style={{ background: "var(--k-tint-teal)", color: "var(--k-text-teal)" }}>
                          AMS
                        </span>
                      )}
                      {!c.hasImplementation && !c.hasAms && (
                        <span className="text-[11px] text-k-mute-2">—</span>
                      )}
                    </div>
                  </td>
                  <td className="k-mono px-[18px] py-2 text-right text-[11.5px] text-k-mute">
                    {c.counts.integrations}
                  </td>
                  <td className="k-mono px-[18px] py-2 text-right text-[11.5px] text-k-mute">
                    {c.counts.modules}
                  </td>
                  <td className="k-mono px-[18px] py-2 text-right text-[11.5px] text-k-mute">
                    {c.counts.workLog}
                  </td>
                  <td className="px-[18px] py-2 text-right">
                    {!readOnly && (
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <button
                          type="button"
                          className="k-btn k-btn-ghost h-7 w-7 justify-center p-0"
                          aria-label={`Actions for ${c.name}`}
                        >
                          <MoreHorizontal size={15} strokeWidth={1.5} aria-hidden />
                        </button>
                      </Menu.Trigger>
                      <Menu.Portal>
                        <Menu.Content
                          align="end"
                          sideOffset={4}
                          className="z-50 min-w-[230px] rounded-k border border-k-line bg-k-paper p-1 shadow-[var(--k-shadow-m)]"
                        >
                          <Menu.Item
                            className="k-menu-item"
                            onSelect={() =>
                              setDomainFlag("implementation", !c.hasImplementation)
                            }
                          >
                            {c.hasImplementation ? "Remove from" : "Add to"} Implementation
                          </Menu.Item>
                          <Menu.Item
                            className="k-menu-item"
                            onSelect={() => setDomainFlag("ams", !c.hasAms)}
                          >
                            {c.hasAms ? "Remove from" : "Add to"} AMS &amp; Support
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Portal>
                    </Menu.Root>
                    )}
                  </td>
    </tr>
  );
}
