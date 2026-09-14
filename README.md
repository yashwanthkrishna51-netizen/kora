# Kora v2

Rebuild of **Kora** — Kognoz Consulting's internal client-delivery tracker — on
Next.js + TypeScript, themed on the Kognoz brand, with the database migrated
from jsonb blobs to a normalized schema **in place** (same Supabase project, so
the data never moves providers).

The existing app in `../kora` stays deployed until cutover; it is the rollback
path. **Only one of the two may be writable at a time** — see *One writer* below
and `HANDOVER.md`.

## Status

Built and deployed. Every screen the old app had is here except Sales Pipeline.

| Area | State |
|---|---|
| Kognoz design tokens + `k-*` component layer | done — review at `/styleguide` |
| Drizzle schema + numbered SQL migrations | done, applied |
| Migration tooling (`preflight`/`backfill`/`verify`) | done, proven end to end |
| Auth: password, lockout, Microsoft SSO, roles | done |
| API: 37 route handlers, OCC on every write, audit rows | done |
| Dashboard (admin + personal) | done |
| Integrations tracker | done |
| Implementation tracker (module × nine-phase matrix) | done |
| AMS & Support tracker | done — logic ported from `../kora/js/ams.js` |
| Admin: users, clients, settings, audit, restore | done |
| Exports: PDF and Excel, client email | done |
| Daily digest + nightly backup crons | done |
| **Sales Pipeline** | **not built** — see `HANDOVER.md` |

**660 tests** across 41 files: golden-master parity against the original
vanilla-JS functions, mapping rules, migration SQL against real Postgres, the
API read and write paths against PGlite, and the component behaviour that is
invisible in a screenshot.

## One writer

The old app's `api/_dualwrite.js` shadow-writes every save into the `*_v2`
tables and archives any row that is not in the v1 jsonb. So while v1 is live,
anything this app creates is archived the next time v1 saves that client.

`KORA_READ_ONLY=1` (plus `NEXT_PUBLIC_KORA_READ_ONLY=1` for the UI half) makes
every write route answer 423 and hides every write control, so the two can run
side by side safely. Lift it only in the same change that freezes v1.

## Getting started

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

`/styleguide` renders every design atom in both themes. It is the design
approval gate — screens are built from these atoms, so a wrong value there is a
wrong value everywhere.

```bash
pnpm test         # 660 tests
pnpm typecheck
pnpm lint
pnpm build
```

The database tests run against PGlite and need no server. The golden-master
suite needs `../kora` checked out; it skips rather than fails without it.

## Migration

```bash
pnpm migrate:preflight    # read-only scan; produces the data-cleanup list
pnpm migrate:backfill     # dry run by default
pnpm migrate:backfill --execute --i-have-a-backup <dump>
pnpm migrate:verify       # the cutover gate — must exit 0
```

Put the connection string in `.env.local` (gitignored) as
`MIGRATION_DATABASE_URL`, using the Supabase **session-mode pooler on port
5432** — not 6543 (no prepared statements) and not `db.<ref>.supabase.co`
(IPv6-only on the free tier).

Every tool prints its target and mode before doing anything, and anything that
writes to a non-local database makes you type the environment name first.
`preflight` and `verify` never write. `backfill` runs in one transaction and
rolls back on any inconsistency; v1 is never written to, which is what keeps
rollback trivial.

See `db/migrations/APPLIED.md` for migration order and the two gates.

## Layout

```
app/            routes (App Router) + app/api route handlers
app/styleguide  the design reference, every atom in both themes
components/     screens and shared UI
lib/domain/     business logic — RAG calculations, retainer maths, constants
lib/db/         Drizzle schema, queries and mutations
lib/query/      TanStack Query hooks, cache keys, optimistic writes
lib/export/     PDF and Excel generation
lib/digest/     the daily assignee digest
tests/golden/   differential tests against the original implementation
```

## The golden-master tests

The old app's business rules are subtle (three different RAG formulas, a
retainer pool where only the overage is billable) and a silent change to any of
them would quietly move every health indicator in the product.

So `tests/golden/` does not test my *reading* of that logic. It loads the
**original vanilla-JS functions** out of `../kora/js` into a VM and diffs them
against the TypeScript ports across 300 generated clients and five billing
windows, with fixtures deliberately landing on every threshold the rules hinge
on (0/1/7/14 days, exhausted pools, missing dates).

The suite has been mutation-checked: deliberately breaking a threshold or a
balance calculation makes it fail with a concrete input.

If `../kora` isn't present the suite skips rather than fails. Point it elsewhere
with `KORA_LEGACY_ROOT`.

## Conventions

- **Two radii exist**: `4px` and fully round. Nothing else.
- **Cards are flat at rest** — shadow on hover only, never a transform lift.
- **Never render a status `fill` colour as text.** Every hue has a `text`-safe
  pair; `/styleguide` shows them side by side and why.
- **No emoji in UI.** Icons are Lucide at `stroke-width: 1.5`, `currentColor`.
- Class names are `k-` prefixed. The design system's unprefixed `.h1`/`.body`
  are deliberately not shipped — they collide with Tailwind.
- Dark mode is a `dark` class on `<html>`, applied pre-paint and stored under
  the legacy `itk_dark` key so preferences survive cutover.

## Notes

- Next.js 16 renamed `middleware.ts` to **`proxy.ts`**, which runs on the
  Node.js runtime only. Check `node_modules/next/dist/docs/` before assuming an
  API — this version differs from most training data.
- Headings use **Carlito**, the metric-compatible open clone of Calibri, until a
  licensed Calibri is supplied.
- Migration reports and database dumps contain real client data and password
  hashes. They are gitignored and must never be committed.
