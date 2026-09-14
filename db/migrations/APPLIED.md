# Applied migrations

Numbered SQL, applied in order, by hand. There is no migration runner — at this
scale one is more risk than it removes, and the standing project rule is that
SQL is applied and verified before the code that depends on it ships.

```bash
pnpm migrate:doctor              # what is applied, and what would block
pnpm migrate:apply 0003 --dry-run
pnpm migrate:apply 0003
```

`migrate:apply` runs each file in a transaction and makes you type the
environment name first. `psql -f` works equally well if you have it installed.

Record every application below, including the environment. If a file is ever
edited after being applied somewhere, add a new numbered file instead — never
retro-edit an applied one.

| # | File | Local / Docker | Staging | Production | Notes |
|---|------|----------------|---------|------------|-------|
| 0001 | `0001_baseline_v1_schema.sql` | tests | — | **never** | Reconstruction for local use only. Replace with real `pg_dump --schema-only` output. Must NOT be applied to live. |
| 0002 | `0002_v2_schema.sql` | tests | — | pre-existing | As-applied record of the original `sql_v2_migration.sql`. Idempotent. |
| 0003 | `0003_domain_membership.sql` | tests | — | **2026-08-31** | Additive; safe to apply while the old app runs. Required before backfill. |
| 0004 | `0004_client_name_ci_unique.sql` | tests | — | **2026-08-31** | **Gate.** Apply only after preflight reports zero duplicate client names. |
| 0005 | `0005_backend_indexes.sql` | tests | — | **2026-08-31** | Additive. Fails if two usernames collide case-insensitively. |
| 0006 | `0006_updated_at_trigger.sql` | tests, local, **production** | 2026-09-01 | applied | Makes `updated_at` a trigger. Leaving it to each statement means forgetting it anywhere silently disables OCC for that entity — writes keep returning 200 while overwriting each other. `before update` only, so the backfill's preserved v1 timestamps on INSERT are untouched and re-running it stays idempotent. |

## Order and dependencies

- `0003` and `0005` are additive and independent — apply any time.
- `0004` depends on the live data being clean. Run `pnpm migrate:preflight`
  first; it fails loudly rather than letting duplicates through.
- `0001` is for building throwaway databases only. Applying it to an
  environment that already has real `clients` data does nothing (`if not
  exists`), but it must never be treated as the authoritative v1 schema.

## Connection string

Use the Supabase **session-mode pooler** on port 5432:

```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
```

Not the direct host (`db.<ref>.supabase.co`) — on the free tier it is IPv6-only
and unreachable from most networks and from Vercel. Not transaction mode
(port 6543) either: it does not support the prepared statements `psql` and
`pg_dump` rely on. The application uses port 6543; tooling uses 5432.

## Production run — 2026-08-31

Applied 0003, 0004 and 0005 against production, then rebuilt the v2 shadow
tables and verified. All additive; the v1 tables were never written to.

| | |
|---|---|
| clients | 22 |
| integrations | 29 |
| milestones | 1 |
| modules | 78 |
| phases | 702 |
| ams work-log entries | 2 |
| attachments | 44, all resolved to a storagePath |

`migrate:verify` passed all three legs with 0 unexplained differences, and
every domain flag matches the v1 sentinel exactly.

Six clients belong to a domain while having zero rows in it — 2X Marketing and
Swastik (Implementation), Altius Infrastructure, Anand, Interglobe Aviation and
NabFID (AMS). Without migration 0003 every one of them would have silently
disappeared from that view at cutover. This is why the flags exist, and why
`check-membership` is worth re-running before the final cutover.

## 0006_updated_at_trigger.sql — APPLIED to production, 2026-09-01

Verified after applying: the `set_updated_at` function exists, all **7 of 7**
triggers are present and enabled (`clients_v2`, `integrations_v2`,
`milestones_v2`, `modules_v2`, `phases_v2`, `ams_work_log_v2`, `users`), and
`migrate:verify` still passes all three legs with 0 unexplained differences.

Confirmed working rather than assumed: an UPDATE that does NOT set
`updated_at` — a no-op write on one client — advanced the token from
`2026-08-27T14:11:43.262Z` to `2026-09-01T11:11:24.518Z` and left the data
untouched. **Optimistic concurrency is live on production.** Before this, every
stale write would have returned 200 while silently overwriting.

**What it does.** `updated_at` is the OCC token: a GET hands it out as `_v`, a
PATCH echoes it in `If-Match`, and the UPDATE matches on equality. The v2
tables default it on INSERT and leave it alone on UPDATE, so advancing it was
left to every individual statement. Forgetting it anywhere does not fail
loudly — the write succeeds, the token stops changing, and from then on
concurrent edits to that entity silently overwrite each other while `If-Match`
keeps returning 200. A trigger cannot be forgotten, and it also stops a client
pinning the column by sending its own value.

Additive, idempotent, `before update` only — the backfill preserves v1
timestamps on INSERT and is unaffected, so re-running it stays idempotent.
