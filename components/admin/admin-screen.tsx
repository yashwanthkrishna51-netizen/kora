"use client";

import { useState } from "react";
import { UsersTab } from "./users-tab";
import { ClientsTab } from "./clients-tab";
import { AuditTab } from "./audit-tab";
import { SettingsTab } from "./settings-tab";
import { BackupsTab } from "./backups-tab";
import { isReadOnlyBuild } from "@/lib/query/permissions";

/**
 * Admin.
 *
 * Five tabs. The handoff's artboard draws four — Users, Audit log, Settings,
 * Backups — and drops v1's three tracker-admin tabs (Integrations,
 * Implementations, AMS). Those three were the same table three times with a
 * different count column, so they collapse into one `Clients` tab with domain
 * filter chips; nothing v1 could do is lost, and the near-duplicate code is.
 *
 * Tab state is local, not in the URL. It is a view preference inside one
 * screen rather than a location — and putting it in the URL would mean
 * `/admin?tab=audit` deep links that outlive a tab being renamed.
 */

const TABS = [
  { id: "users", label: "Users" },
  { id: "clients", label: "Clients" },
  { id: "audit", label: "Audit log" },
  { id: "settings", label: "Settings" },
  { id: "backups", label: "Backups" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AdminScreen({ userCount }: { userCount: number }) {
  const [tab, setTab] = useState<TabId>("users");
  const readOnly = isReadOnlyBuild();

  return (
    <div className="p-6 md:px-7 md:pb-8">
      <h1 className="k-page-title">Admin</h1>
      <p className="mt-1.5 mb-[18px] text-[13px] text-k-mute">
        {userCount} {userCount === 1 ? "account" : "accounts"} · role-based
        access · every mutation is logged
      </p>

      {/* Said here as well as in the top banner. Every control on this screen
          is a write, so under read-only the screen looks stripped — and an
          admin who does not know why will assume it failed to load. */}
      {readOnly && (
        <div className="k-callout mb-[18px]">
          Admin actions are unavailable while Kora is read-only. Manage users,
          settings and restores in the current Kora; everything here still
          reads live.
        </div>
      )}

      <div className="k-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`admin-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`admin-panel-${t.id}`}
            className="k-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`admin-panel-${tab}`}
        aria-labelledby={`admin-tab-${tab}`}
        className="pt-[18px]"
      >
        {tab === "users" && <UsersTab />}
        {tab === "clients" && <ClientsTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "settings" && <SettingsTab />}
        {tab === "backups" && <BackupsTab />}
      </div>
    </div>
  );
}
