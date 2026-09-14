"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useClientList, useClientTrees, useUsers } from "@/lib/query/hooks";
import { useSession } from "@/lib/query/permissions";
import { STATUS_COLORS } from "@/lib/domain/constants";

/**
 * NOT MOUNTED UNTIL IT IS OPENED, and that is a data decision rather than a
 * rendering one.
 *
 * The palette lives in the app chrome, so it renders above every route. Its
 * three queries were gated with `enabled: false`, which does not fetch — but
 * DOES create the cache entry, because constructing a `QueryObserver` calls
 * `queryCache.build()`. An entry that exists but holds no data is exactly what
 * makes `HydrationBoundary` defer: it hydrates missing queries during render
 * and existing ones in an effect, and effects do not run during SSR. So the
 * server rendered the client rail empty while the browser rendered it full, the
 * hydration mismatch threw away the server HTML, and every screen below fetched
 * over HTTP data that had already arrived with the document.
 *
 * Returning null is the whole fix. No observer, no cache entry, nothing to
 * defer — and three fewer subscriptions on every page.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return <PaletteDialog onOpenChange={onOpenChange} />;
}

/**
 * The ⌘K command palette (artboard 1h).
 *
 * The trigger for this has been in the sidebar since the shell was built, with
 * a comment saying to restore it "in the same commit as the palette" — this is
 * that commit. Until now the desktop sidebar was passed no `onSearch` at all,
 * so the control was hidden, and the mobile drawer's handler only closed the
 * drawer. Pressing ⌘K did nothing anywhere.
 *
 * IT DOES NOT MAKE THE APP SLOWER TO SEARCH. The client list is already in
 * cache for every rail, and the full tree — the only source for integrations,
 * phases and work-log entries — is fetched ONLY while the palette is open. That
 * matters because moving the tracker index screens off the tree was the point
 * of the previous commit; re-introducing it on every page to power a search box
 * nobody has opened would have undone it.
 */
function PaletteDialog({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const session = useSession();
  const isAdmin = session?.role === "admin";

  // Unconditional, because this component only exists while the palette is
  // open. That replaces the `enabled: open` gate above it, which stopped the
  // requests but not the cache entries — see the note on CommandPalette.
  const clients = useClientList();
  const trees = useClientTrees();
  const users = useUsers();

  // Reset on the way out rather than in an effect watching `open`: a setState
  // in an effect body cascades a render, and React 19 lints it.
  function setOpen(next: boolean) {
    if (!next) setQuery("");
    onOpenChange(next);
  }

  const results = useMemo(
    () =>
      buildResults({
        query,
        clients: clients.data ?? [],
        trees: trees.data ?? [],
        users: isAdmin ? (users.data ?? []) : [],
      }),
    [query, clients.data, trees.data, users.data, isAdmin],
  );

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <Command.Dialog
      open
      onOpenChange={setOpen}
      label="Search Kora"
      // Ranking is ours (see buildResults) — cmdk's own fuzzy filter would
      // reorder across domains and lose the "clients first, then work" shape.
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-[80] bg-[rgba(33,33,33,.35)]"
      contentClassName="fixed left-1/2 top-16 z-[81] w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-k border border-k-line bg-k-paper shadow-[var(--k-shadow-l)]"
    >
      <div className="flex items-center gap-2.5 border-b border-k-line-2 px-4 py-3.5">
        <Search size={17} strokeWidth={1.5} className="shrink-0 text-k-mute-2" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search clients, integrations, phases, work log…"
          className="flex-1 bg-transparent text-[14px] text-k-ink outline-none placeholder:text-k-mute-2"
        />
        <span className="k-kbd shrink-0">esc</span>
      </div>

      <Command.List className="max-h-[52vh] overflow-y-auto p-2">
        <div className="k-eyebrow px-2.5 py-1.5">
          {trees.isLoading && query
            ? "Searching…"
            : `${results.length} result${results.length === 1 ? "" : "s"}`}
        </div>

        <Command.Empty className="px-2.5 py-6 text-center text-[12.5px] text-k-mute">
          Nothing matches “{query}”.
        </Command.Empty>

        {results.map((r) => (
          <Command.Item
            key={r.key}
            value={r.key}
            onSelect={() => go(r.href)}
            className="flex cursor-pointer items-center gap-3 rounded-k px-3 py-2.5 data-[selected=true]:bg-k-primary/[.06]"
          >
            <span
              className="k-tag shrink-0"
              style={{ background: TAG[r.tag].bg, color: TAG[r.tag].fg }}
            >
              {r.tag}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-k-ink">
                {r.label}
              </span>
              {r.sub && (
                <span className="mt-px block truncate text-[11px] text-k-mute-2">
                  {r.sub}
                </span>
              )}
            </span>
            {r.status && (
              <span
                className="shrink-0 text-[11px] font-semibold"
                style={{ color: statusTone(r.status) }}
              >
                {r.status}
              </span>
            )}
          </Command.Item>
        ))}
      </Command.List>

      {/* 1h also advertises a `g d` chord here. There is no such shortcut in
          this app, and a footer that lists a key binding nobody implemented is
          worse than a shorter footer, so only the two real ones are shown. */}
      <div className="flex gap-4 border-t border-k-line-2 px-4 py-2.5 text-[10.5px] text-k-mute-2">
        <span>
          <span className="k-mono">↑↓</span> navigate
        </span>
        <span>
          <span className="k-mono">↵</span> open
        </span>
        <span>
          <span className="k-mono">esc</span> close
        </span>
      </div>
    </Command.Dialog>
  );
}

/* ------------------------------------------------------------------- data */

type Tag = "CLT" | "INT" | "MOD" | "AMS" | "USR" | "GO";

/** README §10's mono type chips, plus two the handoff does not name. */
const TAG: Record<Tag, { bg: string; fg: string }> = {
  CLT: { bg: "var(--k-tint-sky)", fg: "var(--k-text-sky)" },
  INT: { bg: "var(--k-primary-10)", fg: "var(--k-primary)" },
  MOD: { bg: "var(--k-tint-teal)", fg: "var(--k-text-teal)" },
  AMS: { bg: "var(--k-tint-warn)", fg: "var(--k-text-amber)" },
  USR: { bg: "var(--k-tint-grey)", fg: "var(--k-text-grey)" },
  GO: { bg: "var(--k-line-2)", fg: "var(--k-ink-3)" },
};

interface Result {
  key: string;
  tag: Tag;
  label: string;
  sub?: string;
  status?: string;
  href: string;
}

const COMMANDS: { label: string; href: string; adminOnly?: boolean }[] = [
  { label: "Go to Dashboard", href: "/dashboard" },
  { label: "Go to Integrations", href: "/integrations" },
  { label: "Go to Implementation", href: "/implementation" },
  { label: "Go to AMS & Support", href: "/ams" },
  { label: "Go to Admin", href: "/admin", adminOnly: true },
];

const LIMIT_PER_GROUP = 6;

/**
 * Ranking is deliberate rather than fuzzy.
 *
 * Grouped by kind in a fixed order — clients, then the three trackers, then
 * people, then commands — because "payroll" should show the client above the
 * eleven integrations that mention it. Within a group, a prefix match sorts
 * above a substring one, which is what makes typing two letters useful.
 */
function buildResults({
  query,
  clients,
  trees,
  users,
}: {
  query: string;
  clients: { id: string; name: string; counts: { integrations: number } }[];
  trees: import("@/lib/db/queries/clients").ClientTree[];
  users: { username: string; name: string; role: string }[];
}): Result[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    // An empty palette offers the places you can go, not 400 rows of data.
    return COMMANDS.map((c) => ({
      key: `go:${c.href}`,
      tag: "GO" as const,
      label: c.label,
      href: c.href,
    }));
  }

  const hit = (s: string | undefined | null) =>
    Boolean(s && s.toLowerCase().includes(q));
  const rank = (s: string) => (s.toLowerCase().startsWith(q) ? 0 : 1);
  const take = (rs: Result[]) =>
    rs.sort((a, b) => rank(a.label) - rank(b.label)).slice(0, LIMIT_PER_GROUP);

  const out: Result[] = [];

  /**
   * EVERY CLIENT, INCLUDING THE ONES THE RAIL HIDES.
   *
   * The Integrations rail lists a client only once it has an integration, and
   * the `+ Integration` button lives on that client's own page — so this is the
   * search-by-name route to a client that is otherwise not on screen. The
   * subtitle already reads "0 integrations" where that is the case, so nothing
   * here pretends the client has work.
   */
  out.push(
    ...take(
      clients
        .filter((c) => hit(c.name))
        .map((c) => ({
          key: `clt:${c.id}`,
          tag: "CLT" as const,
          label: c.name,
          sub: `${c.counts.integrations} integration${c.counts.integrations === 1 ? "" : "s"}`,
          href: `/integrations/${c.id}`,
        })),
    ),
  );

  const integrations: Result[] = [];
  const phases: Result[] = [];
  const ams: Result[] = [];

  for (const c of trees) {
    for (const i of c.integrations ?? []) {
      if (!hit(i.name)) continue;
      integrations.push({
        key: `int:${c.id}:${i.id}`,
        tag: "INT",
        label: i.name,
        sub: c.name,
        status: i.status,
        href: `/integrations/${c.id}/${encodeURIComponent(i.id)}`,
      });
    }
    for (const m of c.modules ?? []) {
      for (const p of m.phases ?? []) {
        // The module name is searchable too — "core hr" should find its phases.
        if (!hit(p.name) && !hit(m.name)) continue;
        phases.push({
          key: `mod:${c.id}:${m.id}:${p.name}`,
          tag: "MOD",
          label: `${p.name} — ${m.name}`,
          sub: c.name,
          status: p.status,
          href: `/implementation/${c.id}/${m.id}/${encodeURIComponent(p.name)}`,
        });
      }
    }
    for (const w of c.workLog ?? []) {
      if (!hit(w.description) && !hit(w.module) && !hit(w.type)) continue;
      ams.push({
        key: `ams:${c.id}:${w.id}`,
        tag: "AMS",
        label: w.description || w.type || "Work log entry",
        sub: c.name,
        status: w.entryStatus,
        href: `/ams/${c.id}`,
      });
    }
  }

  out.push(...take(integrations), ...take(phases), ...take(ams));

  out.push(
    ...take(
      users
        .filter((u) => hit(u.name) || hit(u.username))
        .map((u) => ({
          key: `usr:${u.username}`,
          tag: "USR" as const,
          label: u.name,
          sub: `${u.username} · ${u.role}`,
          href: "/admin",
        })),
    ),
  );

  out.push(
    ...COMMANDS.filter((c) => hit(c.label)).map((c) => ({
      key: `go:${c.href}`,
      tag: "GO" as const,
      label: c.label,
      href: c.href,
    })),
  );

  return out;
}

function statusTone(status: string): string {
  return (
    STATUS_COLORS[status as keyof typeof STATUS_COLORS]?.text ?? "var(--k-mute)"
  );
}
