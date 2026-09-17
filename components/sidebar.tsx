"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Workflow,
  LayoutGrid,
  LifeBuoy,
  Shield,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
} from "lucide-react";
import { useUi } from "@/lib/store/ui";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/utils/cn";

/**
 * The sidebar.
 *
 * White, not the dark navy the old app used — the handoff is explicit about
 * this, and the active state is a text colour plus an 8% tint rather than a
 * left bar or a filled row (README §2: "no left bar, no dark fill").
 *
 * Widths are 232 expanded / 56 collapsed / 240 as a mobile drawer. Only the
 * 232 is drawn in KoraSidebar.dc.html; the other two are prose, so the
 * collapsed treatment below — centred icons, tooltips via title, group labels
 * hidden — is mine and worth a look.
 */

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  /** Sub-routes that should still light this item up. */
  match: (path: string) => boolean;
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Main",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        match: (p) => p === "/dashboard" || p === "/",
      },
    ],
  },
  {
    label: "Trackers",
    items: [
      {
        href: "/integrations",
        label: "Integrations",
        icon: Workflow,
        match: (p) => p.startsWith("/integrations"),
      },
      {
        // Plural in the nav, singular in the route and the breadcrumb — that
        // inconsistency is in the handoff itself. Following the handoff for
        // the label and the old app for the URL, since the URL is a contract
        // with everyone's bookmarks.
        href: "/implementation",
        label: "Implementations",
        icon: LayoutGrid,
        match: (p) => p.startsWith("/implementation"),
      },
      {
        href: "/ams",
        label: "AMS & Support",
        icon: LifeBuoy,
        match: (p) => p.startsWith("/ams"),
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        href: "/admin",
        label: "Admin",
        icon: Shield,
        adminOnly: true,
        match: (p) => p.startsWith("/admin"),
      },
    ],
  },
];

export interface SidebarUser {
  name: string;
  username: string;
  role: string;
}

export function Sidebar({
  user,
  effectiveRole,
  onSearch,
  paneWidth,
  mobile = false,
  onNavigate,
}: {
  user: SidebarUser;
  /** The role to render for — differs from user.role while previewing. */
  effectiveRole: string;
  /** Absent while the command palette is deferred — see below. */
  onSearch?: () => void;
  /** Expanded width in px, from the resizable pane. Ignored when collapsed. */
  paneWidth?: number;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useUi((s) => s.sidebarCollapsed) && !mobile;
  const toggle = useUi((s) => s.toggleSidebar);
  const [signingOut, setSigningOut] = useState(false);
  const qc = useQueryClient();

  /**
   * Signs out client-side rather than as a form POST.
   *
   * The route returns JSON, so a native form submit would navigate the browser
   * to `{"ok":true}`. `router.refresh()` after the redirect matters too: the
   * cookie is gone but the router still holds the rendered shell, and without
   * it a back-button press shows the app chrome for a session that no longer
   * exists.
   *
   * ONLY NAVIGATE IF THE COOKIE ACTUALLY WENT. The redirect used to sit in a
   * `finally`, so a failed request — offline, a 500 — still sent you to
   * /login while the session survived, and `proxy.ts` bounced you straight
   * back into the app. That reads as the app refusing to sign you out, with
   * nothing said. Now a failure says so and leaves you where you are.
   *
   * THE QUERY CACHE GOES TOO. Every client, work-log row and audit entry this
   * session fetched is still in memory otherwise, and the next person to sign
   * in on this machine gets the previous one's data on screen until each query
   * refetches. `users-tab.tsx` solves the same problem with a hard navigation
   * and says so; clearing the cache is the smaller half of that.
   */
  async function signOut() {
    setSigningOut(true);
    try {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(String(res.status));
      qc.clear();
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out. Check your connection and try again.");
      setSigningOut(false);
    }
  }

  // The expanded width is now the resizable pane's; 56 collapsed and 240 as a
  // mobile drawer stay fixed, because both are modes rather than preferences.
  const width = mobile ? 240 : collapsed ? 56 : (paneWidth ?? 232);

  return (
    <aside
      className="flex h-full flex-none flex-col border-r border-k-line bg-k-paper"
      style={{ width }}
    >
      {/* Header. The logo asset has a baked-in white ground, so it may only
          ever sit on white — never on Deep Blue. */}
      <div
        className={cn(
          "k-side-head flex flex-col items-center gap-1.5 border-b border-k-line-2",
          collapsed ? "px-2 py-4" : "px-4 pb-4 pt-5",
        )}
      >
        <Image
          src="/kognoz-logo.png"
          alt="Kognoz"
          width={collapsed ? 26 : 34}
          height={collapsed ? 26 : 34}
          priority
          className="h-auto w-auto object-contain"
          style={{ height: collapsed ? 20 : 34 }}
        />
        <span
          className="font-k-head font-bold leading-none text-k-primary"
          style={{
            fontSize: collapsed ? 9 : 19,
            letterSpacing: collapsed ? "0.12em" : "0.2em",
          }}
        >
          KORA
        </span>
      </div>

      {/* Search trigger. A button, not an input — it opens the palette.
          Rendered ONLY when a handler is supplied: the palette is deferred, and
          a control that does nothing the first time someone presses it is worse
          than one that is not there. Passing onSearch brings it back. */}
      {onSearch && (
        <div className={cn("k-side-search pb-1", collapsed ? "px-2 pt-3" : "px-3 pt-3")}>
          <button
            type="button"
            onClick={onSearch}
            title={collapsed ? "Search (⌘K)" : undefined}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-[4px] border border-k-line bg-k-surface text-k-mute",
              collapsed ? "justify-center px-0" : "px-2.5",
            )}
            style={{ fontSize: 12 }}
          >
            <Search size={13} strokeWidth={1.5} className="flex-none" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Search…</span>
                <span className="k-kbd">⌘K</span>
              </>
            )}
          </button>
        </div>
      )}

      <nav className="k-side-nav flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2.5">
        {GROUPS.map((group, gi) => {
          const items = group.items.filter(
            (i) => !i.adminOnly || effectiveRole === "admin",
          );
          if (!items.length) return null;

          return (
            <div key={group.label}>
              {!collapsed && (
                <div
                  className="k-nav-group"
                  style={{
                    padding: gi === 0 ? "8px 10px 4px" : "12px 10px 4px",
                  }}
                >
                  {group.label}
                </div>
              )}
              {items.map((item) => {
                const active = item.match(pathname);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    data-active={active}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "k-nav-item",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <Icon size={15} strokeWidth={1.5} className="flex-none" />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Profile footer */}
      <div className="k-side-foot border-t border-k-line-2 p-3">
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-[4px] bg-k-surface",
            collapsed ? "justify-center px-1 py-1.5" : "px-2 py-1.5",
          )}
        >
          <span
            // Not `text-white`: in dark mode the primary is #7FC4E8 and white
            // on it measures 1.87:1. `--k-on-primary` is white's per-theme
            // counterpart, and the primary button takes its label from the
            // same token.
            className="k-side-avatar flex h-7 w-7 flex-none items-center justify-center rounded-full bg-k-primary font-k-head text-[12px] font-bold text-[var(--k-on-primary)]"
            aria-hidden="true"
          >
            {(user.name || user.username).charAt(0).toUpperCase()}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-k-ink">
                {user.name || user.username}
              </div>
              <div className="k-eyebrow">{effectiveRole}</div>
            </div>
          )}
        </div>

        <div
          className={cn(
            "mt-2 flex gap-1",
            collapsed ? "flex-col items-center" : "items-center",
          )}
        >
          <ThemeToggle
            className="k-btn k-btn-ghost k-btn-sm !px-2"
            showLabel={!collapsed}
          />
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="k-btn k-btn-ghost k-btn-sm !px-2"
            title="Sign out"
          >
            <LogOut size={15} strokeWidth={1.5} />
            {!collapsed && (signingOut ? "Signing out…" : "Sign out")}
          </button>
          {!mobile && (
            <button
              type="button"
              onClick={toggle}
              className="k-btn k-btn-ghost k-btn-sm ml-auto !px-2"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen size={15} strokeWidth={1.5} />
              ) : (
                <PanelLeftClose size={15} strokeWidth={1.5} />
              )}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
