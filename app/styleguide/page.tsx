"use client";

import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Zap,
  BarChart3,
  Clock,
  Settings,
  Search,
  Paperclip,
  Check,
} from "lucide-react";
import Image from "next/image";
import { ThemeToggle, useTheme } from "@/components/theme";
import { ContrastPanel } from "@/components/contrast-panel";
import {
  STATUSES,
  STATUS_COLORS,
  RAG_COLORS,
  PHASES,
} from "@/lib/domain/constants";
import type { Status } from "@/lib/domain/types";

/**
 * Design-system reference page.
 *
 * This is the Stage 0 approval gate: every atom the app is built from, in both
 * themes, on one page. It renders straight from the tokens in globals.css, so
 * if a value is wrong here it is wrong everywhere — which is the point.
 *
 * Not linked from the app shell; reachable at /styleguide.
 */

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 border-b border-k-line pb-2">
        <h2 className="k-page-title text-[18px]">{title}</h2>
        {note ? <p className="mt-1 text-k-meta text-k-mute">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Resolves the CSS variable to whatever it actually computes to in the current
 * theme, so the caption never claims a light-mode hex while showing the dark
 * one. `themeKey` forces a re-resolve when the theme flips.
 */
function Swatch({
  name,
  value,
  themeKey,
}: {
  name: string;
  value: string;
  themeKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState("");

  useEffect(() => {
    if (!ref.current) return;
    setResolved(getComputedStyle(ref.current).backgroundColor);
  }, [themeKey, value]);

  return (
    <div className="k-card overflow-hidden">
      <div ref={ref} className="h-14 w-full" style={{ background: value }} />
      <div className="p-2.5">
        <div className="text-k-label font-semibold text-k-ink">{name}</div>
        <div className="k-mono mt-0.5 text-[10px] text-k-mute-2">
          {rgbToHex(resolved) || value}
        </div>
      </div>
    </div>
  );
}

/** `rgb(0, 81, 132)` -> `#005184`. Leaves anything unexpected alone. */
function rgbToHex(rgb: string): string {
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "";
  return (
    "#" +
    [m[1], m[2], m[3]]
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

export default function StyleguidePage() {
  const [chip, setChip] = useState("All");
  const { dark } = useTheme();
  const themeKey = dark ? "dark" : "light";

  return (
    <div className="min-h-screen bg-k-surface">
      {/* Page header */}
      <div className="border-b border-k-line bg-k-paper px-8 py-5">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between">
          <div>
            <div className="k-mono text-[10.5px] uppercase tracking-[0.06em] text-k-mute-2">
              Kognoz design system
            </div>
            <h1 className="k-page-title mt-1 text-k-h1">Kora styleguide</h1>
            <p className="mt-1 text-k-nav text-k-mute">
              Every atom, both themes. Approve this before screens get built.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-8 py-8">
        {/* ---------------------------------------------------------------- */}
        <Section
          title="Brand"
          note="Primary is Kognoz Deep Blue. Verified against the logo: wordmark #005082, tagline #0099DA, mark tip #74A63F."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Swatch
              name="Primary"
              value="var(--k-primary)"
              themeKey={themeKey}
            />
            <Swatch
              name="Primary hover"
              value="var(--k-primary-hover)"
              themeKey={themeKey}
            />
            <Swatch name="Cyan" value="var(--k-cyan)" themeKey={themeKey} />
            <Swatch name="Sky" value="var(--k-sky)" themeKey={themeKey} />
            <Swatch name="Teal" value="var(--k-teal)" themeKey={themeKey} />
            <Swatch name="Green" value="var(--k-green)" themeKey={themeKey} />
            <Swatch name="Olive" value="var(--k-olive)" themeKey={themeKey} />
            <Swatch name="Grey" value="var(--k-grey)" themeKey={themeKey} />
            <div className="k-card col-span-2 overflow-hidden lg:col-span-4">
              <div
                className="h-14 w-full"
                style={{ background: "var(--k-gradient)" }}
              />
              <div className="p-2.5">
                <div className="text-k-label font-semibold text-k-ink">
                  Brand gradient
                </div>
                <div className="k-mono mt-0.5 text-[10px] text-k-mute-2">
                  linear-gradient(135deg, #009BDD, #75A02F) — the logo mark
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Surfaces & ink"
          note="Page ground is --k-surface; cards sit on --k-paper. Both are neutral in either theme — the hue on screen should be the data's, not the ground's."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <Swatch name="paper" value="var(--k-paper)" themeKey={themeKey} />
            <Swatch
              name="surface"
              value="var(--k-surface)"
              themeKey={themeKey}
            />
            <Swatch name="line-2" value="var(--k-line-2)" themeKey={themeKey} />
            <Swatch name="line" value="var(--k-line)" themeKey={themeKey} />
            <Swatch name="field" value="var(--k-field)" themeKey={themeKey} />
            <Swatch name="mute-2" value="var(--k-mute-2)" themeKey={themeKey} />
            <Swatch name="mute" value="var(--k-mute)" themeKey={themeKey} />
            <Swatch name="ink-3" value="var(--k-ink-3)" themeKey={themeKey} />
            <Swatch name="ink-2" value="var(--k-ink-2)" themeKey={themeKey} />
            <Swatch name="ink" value="var(--k-ink)" themeKey={themeKey} />
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Fill vs text-safe"
          note="Every status hue is a pair. The fill is for dots, bars and cells; the text-safe variant is the only one allowed on text. Never swap them."
        >
          <div className="k-card overflow-hidden">
            <div className="k-thead grid grid-cols-[1fr_90px_1fr_1fr]">
              <span>Role</span>
              <span>Fill</span>
              <span>Fill as text (do not use)</span>
              <span>Text-safe (use this)</span>
            </div>
            {(
              [
                ["Risk / red", "--k-fill-risk", "--k-text-red"],
                ["Warning / amber", "--k-fill-warn", "--k-text-amber"],
                ["Positive / green", "--k-green", "--k-text-green"],
                ["Cyan", "--k-cyan", "--k-text-cyan"],
                ["Sky", "--k-sky", "--k-text-sky"],
                ["Olive", "--k-olive", "--k-text-olive"],
                ["Teal", "--k-teal", "--k-text-teal"],
                ["Grey", "--k-grey", "--k-text-grey"],
              ] as const
            ).map(([label, fill, safe]) => (
              <div
                key={label}
                className="k-row grid grid-cols-[1fr_90px_1fr_1fr] items-center"
              >
                <span className="font-semibold text-k-ink">{label}</span>
                <span
                  className="h-4 w-10 rounded-k"
                  style={{ background: `var(${fill})` }}
                />
                <span style={{ color: `var(${fill})` }}>
                  Fails contrast on white
                </span>
                <span
                  style={{ color: `var(${safe})` }}
                  className="font-semibold"
                >
                  Passes AA
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Typography"
          note="Headings and every large numeral use Carlito (Calibri's metric-compatible clone). Body is Open Sans. Figures, dates and IDs are JetBrains Mono."
        >
          <div className="k-card space-y-3 p-6">
            <div className="k-page-title text-k-login">
              Every client. Every phase.
            </div>
            <div className="k-page-title text-k-h1">Portfolio — 26px h1</div>
            <div className="k-page-title text-k-h2">Page title — 22px h2</div>
            <div className="k-card-title">Card title — 14px 700</div>
            <div className="text-k-nav text-k-ink">Nav / tab label — 13px</div>
            <div className="text-k-body text-k-ink">
              Table row and body copy — 12.5px. This is the workhorse size; the
              app is deliberately dense.
            </div>
            <div className="text-k-small text-k-mute">
              Secondary / footnote — 11.5px
            </div>
            <div className="k-eyebrow">Eyebrow / column header — 10px</div>
            <div className="k-mono text-[11px] text-k-mute">
              31 Aug 2026 · 103.5h · ₹8,28,000 — JetBrains Mono
            </div>
            <div className="k-num text-[28px] text-k-ink">78%</div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Buttons"
          note="Heights 40 / 34 / 32 / 30. Radius 4px. Active scales to .98 for 80ms."
        >
          <div className="k-card flex flex-wrap items-center gap-3 p-6">
            <button className="k-btn k-btn-primary k-btn-lg">Sign In</button>
            <button className="k-btn k-btn-primary k-btn-md">
              Portfolio Export
            </button>
            <button className="k-btn k-btn-primary">+ Integration</button>
            <button className="k-btn k-btn-outline k-btn-md">Customize</button>
            <button className="k-btn k-btn-outline">Export ▾</button>
            <button className="k-btn k-btn-ghost k-btn-sm">
              Configure weights
            </button>
            <button className="k-btn k-btn-primary" disabled>
              Disabled
            </button>
            <button className="k-btn-link">+ Add milestone</button>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Form controls"
          note="Focus is a 3px primary ring at 12% alpha plus a primary border."
        >
          <div className="k-card grid gap-5 p-6 sm:grid-cols-2">
            <div>
              <label className="k-label">Username</label>
              <input className="k-input" placeholder="you@kognoz.com" />
            </div>
            <div>
              <label className="k-label">Password</label>
              <input
                className="k-input"
                type="password"
                defaultValue="passw0rd"
              />
            </div>
            <div>
              <label className="k-label">Filter (small)</label>
              <input
                className="k-input k-input-sm"
                placeholder="Filter clients…"
              />
            </div>
            <div>
              <label className="k-label">Read mode</label>
              <div className="k-field">Arjun Mehta</div>
            </div>
            <div>
              <label className="k-label">Read mode, editable</label>
              <button type="button" className="k-field k-field-edit">
                Arjun Mehta
              </button>
              <span className="mt-1 block text-[11px] text-k-mute">
                Identical at rest so a record card is not a grid of boxes; the
                border and ground lift on hover.
              </span>
            </div>
            <div>
              <label className="k-label">Select</label>
              <select className="k-select" defaultValue="In Progress">
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="k-label">Checkbox</label>
              <div className="flex items-center gap-2 pt-1">
                <span className="k-check" data-checked="true" aria-hidden>
                  <Check size={11} strokeWidth={2.5} />
                </span>
                <span className="text-[12.5px] text-k-ink">UAT sign-off</span>
                <span
                  className="k-check ml-4"
                  data-checked="false"
                  aria-hidden
                />
                <span className="text-[12.5px] text-k-ink">Go-live plan</span>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="k-label">Textarea</label>
              <textarea
                className="k-textarea"
                rows={3}
                defaultValue={
                  "Payroll cutover rehearsed with the client.\nSign-off document attached."
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className="k-label">Invalid state</label>
              <input
                className="k-input"
                aria-invalid="true"
                aria-describedby="sg-err"
                defaultValue=""
              />
              <span id="sg-err" className="k-error">
                Name is required
              </span>
              <span className="mt-1 block text-[11px] text-k-mute">
                Colour is never the only signal — the message is wired with
                aria-describedby, because a red border says nothing to a screen
                reader.
              </span>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Status pills"
          note="10.5px / 600, pill radius, tinted background with the text-safe foreground. No borders — that is the one rule that separates them from chips."
        >
          <div className="k-card flex flex-wrap gap-2 p-6">
            {STATUSES.map((s) => (
              <span
                key={s}
                className="k-status"
                style={{
                  background: STATUS_COLORS[s].tint,
                  color: STATUS_COLORS[s].text,
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="RAG, dots and tags">
          <div className="k-card flex flex-wrap items-center gap-6 p-6">
            <div className="flex items-center gap-3">
              {(["Red", "Amber", "Green"] as const).map((r) => (
                <span key={r} className="flex items-center gap-2">
                  <span
                    className="k-dot"
                    style={{ background: RAG_COLORS[r].fill }}
                  />
                  <span
                    className="text-k-small font-semibold"
                    style={{ color: RAG_COLORS[r].text }}
                  >
                    {r}
                  </span>
                </span>
              ))}
              <span className="flex items-center gap-2">
                <span className="k-dot border border-k-line bg-transparent" />
                <span className="text-k-small text-k-mute-2">Not tracked</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["INT", "var(--k-primary-10)", "var(--k-primary)"],
                  ["MOD", "var(--k-tint-teal)", "var(--k-text-teal)"],
                  ["AMS", "var(--k-tint-warn)", "var(--k-text-amber)"],
                  ["USR", "var(--k-tint-grey)", "var(--k-text-grey)"],
                  ["PDF", "var(--k-primary-08)", "var(--k-primary)"],
                ] as const
              ).map(([label, bg, fg]) => (
                <span
                  key={label}
                  className="k-tag"
                  style={{ background: bg, color: fg }}
                >
                  {label}
                </span>
              ))}
            </div>

            <span className="k-kbd">⌘K</span>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Filter chips"
          note="Click to see the active state. Hover borders go primary."
        >
          <div className="k-card flex flex-wrap items-center gap-2 p-6">
            {[
              "All",
              "At Risk",
              "In Progress",
              "Pending Client",
              "Completed",
            ].map((c) => (
              <button
                key={c}
                className="k-chip"
                data-active={chip === c}
                onClick={() => setChip(c)}
              >
                {c}
              </button>
            ))}
            <span className="ml-auto text-k-small text-k-mute-2">
              8 of 8 shown
            </span>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Sidebar nav"
          note="The sidebar is --k-paper: white in light, near-black in dark. Active state is a tint plus colour plus weight — no left bar, no dark fill."
        >
          <div className="w-[232px] rounded-k border border-k-line bg-k-paper p-3">
            <div className="k-nav-group !pt-1">Main</div>
            <div className="k-nav-item" data-active="true">
              <LayoutGrid size={15} strokeWidth={1.5} />
              Dashboard
            </div>
            <div className="k-nav-group">Trackers</div>
            <div className="k-nav-item">
              <Zap size={15} strokeWidth={1.5} />
              Integrations
            </div>
            <div className="k-nav-item">
              <BarChart3 size={15} strokeWidth={1.5} />
              Implementations
            </div>
            <div className="k-nav-item">
              <Clock size={15} strokeWidth={1.5} />
              AMS &amp; Support
            </div>
            <div className="k-nav-group">System</div>
            <div className="k-nav-item">
              <Settings size={15} strokeWidth={1.5} />
              Admin
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="KPI tiles"
          note="Each tile carries a 3px left accent rail in its own colour."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["9", "Clients", "var(--k-primary)", "var(--k-ink)"],
                [
                  "11",
                  "Critical items",
                  "var(--k-fill-risk)",
                  "var(--k-text-red)",
                ],
                ["34", "Updates · 7 days", "var(--k-sky)", "var(--k-ink)"],
                [
                  "2 · 3 · 4",
                  "Health split R · A · G",
                  "var(--k-fill-warn)",
                  "var(--k-ink)",
                ],
                [
                  "2",
                  "L3 / L4 open",
                  "var(--k-fill-risk)",
                  "var(--k-text-red)",
                ],
                [
                  "78%",
                  "Data hygiene",
                  "var(--k-green)",
                  "var(--k-text-green)",
                ],
              ] as const
            ).map(([value, label, accent, color]) => (
              <div
                key={label}
                className="k-card px-4 py-3.5"
                style={{ borderLeft: `3px solid ${accent}` }}
              >
                <div className="k-num text-[28px]" style={{ color }}>
                  {value}
                </div>
                <div className="mt-[7px] text-k-label leading-[1.35] text-k-mute">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Table"
          note="Header sits on --k-surface; rows divide on --k-line-2 and hover at 4% primary."
        >
          <div className="k-card overflow-hidden">
            <div className="k-thead grid grid-cols-[1fr_130px_118px_96px]">
              <span>Integration ↑</span>
              <span>Status</span>
              <span>Assignee</span>
              <span>Due</span>
            </div>
            {(
              [
                ["Payroll → SAP posting", "At Risk", "Kavya Iyer", "02 Sep"],
                ["Benefits vendor API", "In Progress", "Arjun Mehta", "18 Sep"],
                [
                  "Learning catalogue import",
                  "Completed",
                  "Priya Nair",
                  "12 Aug",
                ],
              ] as [string, Status, string, string][]
            ).map(([name, status, who, due]) => (
              <div
                key={name}
                className="k-row k-row-hover grid grid-cols-[1fr_130px_118px_96px] items-center"
              >
                <span className="font-semibold text-k-ink">{name}</span>
                <span>
                  <span
                    className="k-status"
                    style={{
                      background: STATUS_COLORS[status].tint,
                      color: STATUS_COLORS[status].text,
                    }}
                  >
                    {status}
                  </span>
                </span>
                <span className="text-k-ink-3">{who}</span>
                <span
                  className="k-mono text-[11px]"
                  style={{
                    color:
                      status === "At Risk"
                        ? "var(--k-text-red)"
                        : "var(--k-mute)",
                  }}
                >
                  {due}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Phase track"
          note="The nine fixed phases. Completed / current / future."
        >
          <div className="k-card p-5">
            <div className="flex gap-0">
              {PHASES.map((p, i) => (
                <div
                  key={p}
                  className="flex min-w-0 flex-1 flex-col items-center gap-[7px]"
                >
                  <div
                    className="h-1 w-full rounded-[2px]"
                    style={{
                      background:
                        i < 5
                          ? "var(--k-green)"
                          : i === 5
                            ? "var(--k-fill-warn)"
                            : "var(--k-line)",
                    }}
                  />
                  <div
                    className="text-center text-k-micro leading-[1.2]"
                    style={{
                      color:
                        i < 5
                          ? "var(--k-text-green)"
                          : i === 5
                            ? "var(--k-text-amber)"
                            : "var(--k-mute-2)",
                      fontWeight: i === 5 ? 700 : 400,
                    }}
                  >
                    {p}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Banners, callouts and states">
          <div className="space-y-4">
            <div className="k-callout">
              This phase is a sign-off gate. Attach the signed document to an
              update before marking it complete.
            </div>

            <div className="k-conflict">
              <div className="text-[13px] font-bold text-k-text-amber">
                Someone else saved this record first
              </div>
              <p className="mt-1.5 text-k-body leading-[1.6] text-k-ink-3">
                Your changes to <strong>Payroll → SAP posting</strong> were not
                saved. Reload to see the current version.
              </p>
              <div className="mt-3 flex gap-2">
                <button className="k-btn k-btn-primary k-btn-sm">
                  Reload record
                </button>
                <button className="k-btn k-btn-outline k-btn-sm">
                  Show what changed
                </button>
              </div>
            </div>

            <div className="k-banner-offline rounded-k">
              <span className="h-[7px] w-[7px] rounded-full bg-white" />
              You are offline — saves will fail until your connection is
              restored.
            </div>

            <div className="k-banner-viewas">
              <span
                className="k-dot"
                style={{ background: "var(--k-primary)" }}
              />
              Previewing as viewer
              <button className="k-btn k-btn-primary k-btn-sm ml-auto">
                Exit preview
              </button>
            </div>

            <div className="k-card flex items-center gap-3 p-4">
              <div className="k-spinner" />
              <div>
                <div className="text-k-nav font-semibold text-k-ink">
                  Loading portfolio…
                </div>
                <div className="text-k-label text-k-mute-2">
                  Reconciling snapshots
                </div>
              </div>
            </div>

            <div className="k-card space-y-2.5 p-5">
              <div className="k-skeleton h-[22px] w-[180px]" />
              <div className="k-skeleton h-[13px] w-[280px]" />
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="k-skeleton h-[72px]" />
                <div className="k-skeleton h-[72px]" />
                <div className="k-skeleton h-[72px]" />
              </div>
            </div>

            <div className="k-card p-8 text-center">
              <div className="mx-auto mb-3.5 flex h-11 w-11 items-center justify-center rounded-k border-[1.5px] border-dashed border-k-field">
                <Paperclip
                  size={20}
                  strokeWidth={1.5}
                  className="text-k-mute-2"
                />
              </div>
              <div className="k-card-title text-[16px]">
                No integrations yet
              </div>
              <p className="mx-auto mt-1.5 max-w-[320px] text-k-body leading-[1.6] text-k-mute">
                Add the first integration for this client, or import a batch
                from a CSV.
              </p>
              <div className="mt-4 inline-flex gap-2">
                <button className="k-btn k-btn-primary">+ Integration</button>
                <button className="k-btn k-btn-outline">Import from CSV</button>
              </div>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Search trigger"
          note="The sidebar's command-palette entry point."
        >
          <div className="w-[208px]">
            <div className="flex h-8 items-center gap-2 rounded-k border border-k-line bg-k-surface px-2.5 text-k-meta text-k-mute">
              <Search size={13} strokeWidth={1.5} />
              <span className="flex-1">Search…</span>
              <span className="k-kbd">⌘K</span>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Contrast"
          note="Measured live from the tokens currently rendering. Toggle the theme and the numbers change. Dark mode is the half the handoff never specified, so it is checked rather than assumed."
        >
          <ContrastPanel />
          <p className="mt-3 text-k-small leading-[1.6] text-k-mute">
            Every pair the app renders meets AA in both themes, enforced by a
            test that reads these same tokens. Two handoff values did not and
            were changed: eyebrows now use <code>--k-mute</code>, because on
            white no colour lighter than it reaches AA — <code>#71717A</code> is
            literally the first passing value, so the pale fourth text tier the
            handoff asks for cannot exist. Form-control borders moved to{" "}
            <code>#939598</code>, which is the brand&apos;s own Kognoz grey and
            lands exactly on the 3:1 WCAG asks of a control boundary.
          </p>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Logo"
          note="The supplied PNG has a baked-in white background. On a light surface that is invisible; on Deep Blue or in dark mode it shows as a white slab, so it always sits in a white chip."
        >
          <div className="flex flex-wrap items-start gap-6">
            <div>
              <div className="k-eyebrow mb-2">On white — fine</div>
              <div className="k-card p-4">
                <Image
                  src="/kognoz-logo.png"
                  alt="Kognoz"
                  width={158}
                  height={47}
                />
              </div>
            </div>
            <div>
              <div className="k-eyebrow mb-2">
                On Deep Blue — in a white chip
              </div>
              <div
                className="rounded-k p-4"
                style={{ background: "var(--k-ink-2)" }}
              >
                <span className="inline-block rounded-k bg-white px-3.5 py-2">
                  <Image
                    src="/kognoz-logo.png"
                    alt="Kognoz"
                    width={132}
                    height={39}
                  />
                </span>
              </div>
            </div>
            <div>
              <div className="k-eyebrow mb-2">Never do this</div>
              <div
                className="rounded-k p-4"
                style={{ background: "var(--k-ink-2)" }}
              >
                <Image
                  src="/kognoz-logo.png"
                  alt="Kognoz"
                  width={132}
                  height={39}
                />
              </div>
            </div>
          </div>
          <p className="mt-3 text-k-small leading-[1.6] text-k-mute">
            A transparent SVG would remove the constraint entirely and let the
            mark sit directly on any surface. Worth requesting from whoever
            holds the brand assets.
          </p>
        </Section>

        <p className="pb-8 text-k-small text-k-mute-2">
          Radii here are only 4px or fully round, cards are flat at rest, and
          there is no emoji anywhere — per the handoff&apos;s hard rules.
        </p>
      </div>
    </div>
  );
}
