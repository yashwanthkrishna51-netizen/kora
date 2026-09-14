# Handover — Kora v2

Kora rebuilt on Next.js + TypeScript, against the same Supabase project, with
the data migrated in place from jsonb blobs to normalized tables.

This document is for whoever reviews it. It says what is here, what is not, and
the one rule that must not be broken while both apps exist.

---

## Read this first: only one app may be writable

The old app's `api/_dualwrite.js` shadow-writes every save into the `*_v2`
tables, and `archiveMissing()` (`_dualwrite.js:60-69`) sets `archived = true` on
any `*_v2` row whose id is not present in the v1 jsonb it just saved.

So a client edited in v1 has its **entire v2 subtree rewritten from the jsonb**,
and anything v2 created for that client — an integration, a phase update, a
work-log entry — is archived. Not corrupted, not merged: archived, silently,
with the user seeing a successful save in both apps.

That makes two live writers unsurvivable, and it is not a bug in either app. It
is what a one-way projection does.

**The gate:** this app ships with a read-only mode.

```
KORA_READ_ONLY=1
NEXT_PUBLIC_KORA_READ_ONLY=1
```

With those set, every write route answers `423` with `readOnly: true`, and the
UI hides write controls rather than offering them and failing. Login, logout and
the two crons are deliberately exempt. Lift the flag only in the same change
that freezes writes in v1 — never before.

---

## What is in this branch

| Screen | State |
|---|---|
| Dashboard — admin and personal | rebuilt |
| Integrations tracker | rebuilt |
| Implementation tracker — module × nine-phase matrix | rebuilt |
| Admin — users, clients, settings, audit, restore | rebuilt |
| AMS & Support | ported, not redesigned — see below |
| **Sales Pipeline** | **absent — see below** |

Also here: Microsoft SSO alongside password login, account lockout, role
permissions, optimistic-concurrency on every write with audit rows, PDF and
Excel exports, the client-email flow, the daily assignee digest and the nightly
backup cron.

**660 tests** across 41 files. `pnpm test` runs them with no server and no
network; the database suites run against PGlite.

## AMS & Support is your logic, not a reimagining

`lib/domain/ams.ts` is a port of `js/ams.js` — `amsTotals`, `amsClientRag`,
`amsEntryAmount`, `entryDate`, `entryType`, `entryRaisedBy`.

It is not trusted to be faithful. `tests/golden/legacy.ts` loads your actual
`js/ams.js` into a VM, and `tests/golden/parity.test.ts` diffs the two
implementations across 300 generated clients and five billing windows, with
fixtures landing on every threshold the rules hinge on — exhausted retainer
pools, missing dates, 0/1/7/14-day boundaries. The suite has been
mutation-checked: breaking a threshold makes it fail with a concrete input.

The same treatment covers `implProgress`, `implAutoRag`, `integRagLabel` and the
dashboard aggregations.

So if AMS behaves differently here than in v1, that is a bug with a failing test
waiting to be written — not a redesign you need to review line by line.

## Sales Pipeline is not here

It landed in v1 on 11 September (`667634e`, `faed701`) and this rewrite predates
it. Nothing has been removed — it was never built here.

**It is the cutover blocker.** Everything else in v1 has an equivalent in this
app; Pipeline does not, and going live without it would lose a working feature.

The good news is that it is the easiest thing in the app to port:

- `pipeline_entries` is already a flat, normalized table with `updated_at`-based
  OCC — no jsonb to unpick, unlike everything else in v1.
- `handlePipeline()` in `api/ops.js` is validation plus PostgREST calls, which
  map almost one-to-one onto route handlers here.
- `js/pipeline.js` is 154 lines of template literals — a list, a detail panel
  and four modals. No charts, no exports.
- The maths is about 40 lines: `pipelineIsStale`, `pipelineWeightedValue`, and
  the funnel reducer.

The one awkward part is the **move** action (`api/ops.js:417-494`), which writes
into `clients.integrations` and `clients.modules` as jsonb. In this app those
are real tables, and while v1 is still live its dual-write would archive rows
written directly. Until cutover, `move` either stays in v1 or is disabled.

## Running it

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm test           # 660
pnpm typecheck && pnpm lint && pnpm build
```

`.env.local.example` lists every variable with a comment on what it is for and
which ones are optional. The ones that matter:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Supabase **transaction** pooler, port 6543 |
| `MIGRATION_DATABASE_URL` | **session** pooler, port 5432 — migrations only |
| `INTEGTRACK_SECRET` | signs session tokens and SSO state — **must be a fresh value**, not v1's, or tokens issued by the old app would validate here |
| `KORA_READ_ONLY` / `NEXT_PUBLIC_KORA_READ_ONLY` | set both to `1` while v1 is live |
| `CRON_SECRET` | mandatory — unset, both cron routes answer 503 rather than running unauthenticated |
| `KORA_APP_URL` | the app's own URL, no trailing slash; the SSO redirect is built from it |
| `AZURE_*` | one Entra app registration serves both SSO and the digest mailer |

`db/migrations/APPLIED.md` records which migrations have been applied and the
two gates around them. `/styleguide` renders every design atom in both themes.

## Deploying it

**Its own Vercel project.** v1 sits just under Hobby's 12-function cap on
purpose — `api/ops.js` says so in its header — and a Next.js app in the same
project would blow that immediately.

`vercel.json` here pins the region to `bom1`, beside the database in Mumbai.
Measured on the deployed app, that took `/api/health` from ~530 ms to ~128 ms
median; the default US region puts every query on a round trip to another
continent.

The two crons are the same paths and schedules v1 uses, so only one of the two
deployments should have them enabled at a time.

## What merging this would do

This branch replaces the tree: `index.html`, `js/`, `styles.css` and `api/*.js`
give way to a Next.js app. Sales Pipeline goes with them, which is why it has to
be ported first.

Nothing is lost by **reviewing** it — `main` is untouched by a branch. But it
should not be merged until Pipeline exists here and the cutover is planned:
freeze v1 writes, lift `KORA_READ_ONLY`, both in one change.
