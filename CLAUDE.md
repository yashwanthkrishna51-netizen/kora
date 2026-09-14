# CLAUDE.md — Kora Project Context

This file is read automatically by Claude Code. It replaces re-explaining project context every session.

## Project

**Kora** — internal client delivery tracker for **Kognoz** (consulting/SI firm). Tracks 3 domains per client: **Integrations**, **Implementation** (Module → 9 fixed Phases), **AMS & Support** (retainer/billing). Long-term aspiration: possible SaaS product if internal version proves out.

- **Repo:** `https://github.com/yashwanthkrishna51-netizen/kora.git`
- **Stack:** Vanilla JS SPA (no framework, no build step) · Tailwind CDN + custom `styles.css` · Vercel serverless functions · Supabase Postgres (**free tier**) · GitHub for source
- **Vercel domains:** `kora-eight-black.vercel.app`, `integration-tracker-delta.vercel.app`
- **~20 users**, multiple concurrent client implementation projects

---

## STANDING RULES — every session, no exceptions

1. **Always caveman ultra mode** — one-line responses, table-driven info, minimal preamble, direct.
2. **Before ANY change:** fresh `git clone` (discard old local copy), confirm latest commit hash before touching anything.
3. **Every git-instructions block, in this exact order:**
```bash
clear
git pull origin main
git add -A
git commit -m "crisp message here"
git push origin main
```
   `clear` is literal (wipes terminal scrollback) — always first, own line.
4. **Complete files only** — never patches/diffs. User applies changes manually.
5. **Never fabricate file contents** — always verify against actual repo state.
6. Sensitive values (API keys, secrets) live in Vercel env vars only — never in chat/code.
7. **Smaller batches, one risk-category at a time, always leave an easy way back.** Proven necessary multiple times (mobile-responsiveness revert, the Anand data-loss incident). Don't stack large structural changes on `main` without a tested checkpoint between them.
8. SQL migrations must run **before** pushing code that depends on the new column/table, not after or simultaneously.
9. Any deploy changing save/auth semantics needs a follow-up full reload or force-logout-all — already-open tabs keep running old JS indefinitely.

---

## CURRENT SHIPPED STATE

**Security hardening (multiple passes):** CORS lockdown to real domains, server-side role enforcement, bcrypt (cost 12) with legacy SHA-256 lazy-migration, IP-based + per-username login throttling, signed expiring attachment URLs (4h), full audit trail, stored-XSS fixes (esc() everywhere), PostgREST filter-injection fixes (assertIdsDeep), delete-by-omission bulk-guard (20% ratio), password hashes never sent to browser, admin last-admin-guard, generic error responses (correlation ID only).

**Supabase migration:** `api/login.js`, `api/read.js`, `api/write.js`, `api/upload.js` all query Supabase directly via PostgREST REST calls (service-role key). No ORM, raw `fetch()` calls throughout.

**Optimistic concurrency (OCC):** every client/user row carries `updated_at`; every save does a conditional `PATCH ?id=eq.X&updated_at=eq.<lastKnown>` — 409 on conflict, frontend rolls back and heals from fresh data. `_v` field on every client/user object holds this. `saveClients(msg, changedIds)` / `saveUsers(msg, changedIds)` are the only correct way to write — `changedIds` scopes the *upsert* (not yet the delete — see Critical Issues below).

**UI/UX:** Bento Grid dashboard, master-detail (list-left/detail-right) pattern on Integration, Implementation, and AMS client-detail pages, progress-ring + metric-strip client cards, real browser-history URL routing, shared breadcrumbs, click-toggle export dropdown (shared `exportMenuButton()` component — replaced a buggy hover-menu), center loading overlay (backdrop blur + hourglass flip animation + cycling status text, 200ms delay so quick inline edits don't flash it) on top of a thin top-loading-bar, PWA installable (manifest + icons + service worker that wipes stale cache on activate).

**Exports (branding unified):** all filenames now `ClientName_ReportType_DDMonYYYY.ext` (sanitized, no unsafe chars), all use the app's real teal `#0e7490` + blue `#2563eb` (previously mismatched navy/magenta), every cover/detail/thank-you page has the logo consistently placed, AMS Invoice/Billing PDF export was dead code (built, never wired to a button) — now live.

**Backup:** daily cron (`api/cron/backup.js`, Vercel Cron, `vercel.json`) dumps `clients`+`users` tables to the existing `kora-attachments` Storage bucket under a `backups/` prefix, prunes >30 days. Protected by `CRON_SECRET` env var. This exists because **Supabase free tier has zero automated backups.**

---

## 🔴 CRITICAL — UNFIXED, LIVE RISK

**Delete-by-omission uses the browser tab's stale full array, not fresh server state.**

`api/write.js` deletes any client/user row not present in the array the browser just posted (`id=not.in.(...)`). `saveClients()`/`saveUsers()` in `core.js` always send the **entire** local `S.clients`/`S.users` array as `content`, regardless of `changedIds` (which only scopes the *upsert*, not the delete).

**Failure mode:** Tab A sits open, stale. Tab B (or anyone) creates a new client/user. Tab A saves ANY unrelated single-field edit. Tab A's posted array doesn't contain the new record → backend deletes it, silently. The 20%-bulk-delete-guard doesn't catch this if only 1 record is "missing" among many.

This is very likely the actual mechanism behind a prior data-loss incident (15 AMS work-log entries lost on a duplicate "Anand" client row) — more precise than the original theory, and **still live today**.

**Fix direction:** diff the delete step against a **fresh server-side read** of current ids (already fetched once in `write.js` as `currentIds` for the bulk-guard check — reuse it), never against the browser-posted array.

**This is the #1 priority fix, ahead of everything else below.**

---

## OTHER KNOWN ISSUES — ranked

| # | Issue | Where |
|---|---|---|
| 2 | `X-Forwarded-For` trusted without sanitization — IP throttle bypass + audit log spoofing possible | `api/_audit.js` `clientIp()` |
| 3 | Bulk user CSV import: one row with a too-short password aborts the **entire** batch, no per-row indication | `js/core.js` `parseUsersCsv()` doesn't check 8-char min; `api/write.js` `assertPassword()` throws inside `Promise.all` |
| 4 | `change-password.js` doesn't participate in OCC (no `updated_at` check) — narrow race vs. an admin editing the same user concurrently | `api/change-password.js` |
| 5 | "Clear Lockout" admin tool only resets username-axis lockout, not the separate IP-axis throttle — user can still be blocked after "clearing" them | `api/clear-lockout.js` vs `api/_throttle.js` |
| 6 | Duplicate client name still possible — every "add client" flow checks only this tab's local (possibly stale) data; no DB unique constraint, no server-side check | `add-client`/`add-impl-client`/`add-ams-client` flows |
| 7 | Login username lookup is case-sensitive (Postgres `eq.` default) | `api/login.js` |
| 8 | `snapshot.js` POST doesn't validate `clientId` shape/existence (low impact — appears unused/unrendered if forged) | `api/snapshot.js` |

Full test-case matrix (~70 cases across every view) exists from the last full QA audit — ask for it if starting fresh work in an area and want the relevant subset.

---

## PARKED / DEFERRED WORK

- **Assignment-based access scoping** (editors only edit clients/modules they're tagged to) — good idea for governance, but does **NOT** fix the delete-by-omission bug (different problem: how the delete decision is made, not who's allowed to make it). Fix delete-by-omission first, this is a separate later design.
- **Parallel normalized schema** (`clients_v2`, `integrations_v2`, `milestones_v2`, `modules_v2`, `phases_v2`, `ams_work_log_v2`) — full SQL already written, schema-only, not yet applied. Splits every jsonb blob into real columns; soft-delete via `archived` boolean (never hard-delete); activity/update logs deliberately kept as jsonb (each entry already timestamped). Dual-write code and migration/backfill NOT started — do this **after** the delete-by-omission fix, so the same bug isn't duplicated into two schemas.
- **Local Postgres mirror** (second independent backup, different failure domain than Supabase) — steps discussed, not built. Doesn't need to run 24/7; best-effort daily sync is fine.
- **Implementation module×phase grid redesign** — 10 concepts + 10 sub-variants mocked as standalone HTML, never built into the app. Recommended: 2.3 (persistent side panel) or 2.9 (reuse existing phase-detail page, safest). No final choice confirmed.
- **Refactor Plan** (Activity Feed unification, Admin tab consolidation, domain-delete consolidation, input-styling cleanup, API-layer cleanup) — 6-phase plan from a full-codebase audit, fully documented, completely untouched.
- **RAG calculation → admin-configurable** — Implementation's KPI tiles count *clients* at a RAG level, Integration/AMS count *items*. Wants underlying logic configurable via Admin panel. Spec still pending from user.
- **Defer the 4 export libraries** (pptxgenjs, jsPDF+autotable, full XLSX) — currently render-block every page load for every user regardless of use. Single biggest low-risk perf win identified, not yet done.
- **Dashboard aggregates recompute from scratch on every re-render**, including debounced keystrokes — no memoization. Fine at current scale.
- **Styling system unification** (`k-*` CSS classes vs raw Tailwind vs CSS override layer) — foundation for finishing dark mode + removing Tailwind CDN, both blocked on this.
- **Accessibility pass** — deliberately last, to avoid doing it twice (once now, again after style unification).
- **PWA manifest.json branding** — stale (old-teal), separate from the `index.html` meta tag which was already fixed.
- **SSO via Microsoft Entra (SAML 2.0)** — scoped, waiting on 5 config values from the Entra tenant admin.
- **SaaS productization** — waiting on leadership direction (buyer/build-vs-buy). Multi-tenancy is the single blocking architectural gap. SSO via WorkOS and SOC2 tooling (Vanta/Drata) recommended if this path is taken.

---

## HOSTING DECISION (settled, don't re-litigate without new info)

Evaluated Supabase vs Neon vs Firebase (July 2026) for cost-avoidance reasons. **Staying on Supabase free.** Reasoning:
- Firebase is NoSQL (Firestore) — Kora's relational schema (foreign keys, joins) doesn't translate; biggest rewrite of the three; also the most volatile free-tier pricing history.
- Neon is real Postgres (schema ports over) but has **no built-in REST API** — every API file (`login.js`/`read.js`/`write.js`) would need rewriting to a real Postgres client instead of `fetch()` calls, plus no bundled file storage (attachments would need a separate service). Real migration project, not a config change.
- Supabase free (500MB DB, 1GB storage, 5GB egress) is already proven sufficient at ~20 users. The one real gap (no backups) is already solved by the daily cron.
- **Heads up, not urgent:** Supabase requires explicit Postgres `GRANT` statements for new tables created after Oct 30, 2026 (existing tables/grandfathered before then are unaffected). Add explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE x TO anon, authenticated, service_role;` to any new table's migration SQL as cheap insurance, regardless of timing.

---

## KEY ARCHITECTURAL FACTS

- Domain membership implicit: `c.modules !== undefined` → Implementation, `c.workLog !== undefined` → AMS.
- IDs via `uid()` = timestamp+random base36, validated server-side by `assertIdsDeep()` (`api/_validate.js`) — checks fields literally named `id`/`clientId`/`integId`/`moduleId`/`mid`/`tid`/`uid` at any depth. `_v` is deliberately excluded from this list and safe to carry on objects.
- Auth: bcrypt cost 12 + legacy SHA-256 lazy-migration, 7-day tokens with `token_version` revocation, per-username + IP-based throttling (independent axes).
- Backend talks to Supabase only via service-role key; RLS enabled with **zero policies** (correct, by design — everything routes through the backend). Introducing Realtime/WebSockets would be the first time this needs to change.
- No request-payload logging anywhere (`write.js` has zero `console.log`) — Vercel logs cannot help reconstruct lost data content, only confirm a call happened.
- No localStorage caching of client/user data — only session token, view path, sidebar/dark-mode prefs, recently-viewed list.
- Frontend load order: `core.js→shell.js→dashboard.js→integrations.js→implementation.js→ams.js→admin.js→modal.js→export.js→events.js`. Check for name collisions before adding top-level functions.
- `render()` (`shell.js`) **fully replaces `#app`'s innerHTML on every call — no diffing.** Never call it from a timer or anything that isn't a direct result of the user's own action — it will wipe unsaved input in any non-modal text field. (This is why `backgroundRefreshClients()`'s 60s poll updates `S.clients` silently but never calls `render()`.)
- Roboto loads via `styles.css`'s own `@import` (index.html's Google Fonts link only loads JetBrains Mono) — correct, not a bug.
- Current data model: `clients` table with jsonb columns (`integrations`, `modules`, `work_log`) — see Parallel Schema section above for the normalized replacement design, not yet applied.

---

## HOW TO START A SESSION

State the priority list above, pick a number, or name the fix directly ("fix delete-by-omission", "build concept 2.9", "start Phase 0 of the refactor plan"). No need to re-explain any of the above — it's all here.
