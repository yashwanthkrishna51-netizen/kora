-- ============================================================================
-- 0005 — INDEXES AND SUPPORT TABLES THE NEW BACKEND NEEDS
-- ============================================================================
-- Additive and safe to apply while the old app is still serving traffic.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Case-insensitive unique username.
--
-- The old login looked users up with PostgREST `username=eq.<value>`, which is
-- case-sensitive: "Meera" and "meera" are different accounts, and a user who
-- capitalises their username simply fails to log in. The new login lowercases
-- both sides, which requires this index both for correctness (no two accounts
-- may differ only by case) and for lookup performance.
--
-- If this fails, two accounts already collide case-insensitively — resolve by
-- renaming one before applying.
-- --------------------------------------------------------------------------
create unique index if not exists uq_users_username_ci
  on users (lower(username));

-- --------------------------------------------------------------------------
-- Audit-log query support. The admin audit view always sorts newest-first and
-- commonly filters by user; without these it is a sequential scan that grows
-- with the table forever (audit_log is append-only and never pruned).
-- --------------------------------------------------------------------------
create index if not exists idx_audit_log_ts
  on audit_log (ts desc);

create index if not exists idx_audit_log_username_ts
  on audit_log (username, ts desc);

-- --------------------------------------------------------------------------
-- Fixed-window rate limiting.
--
-- Needed because the old /api/ops?op=send-client-email endpoint let any editor
-- send an arbitrary subject, body and multi-MB attachment to any external
-- address from the corporate mailbox, with no limit — a data-exfiltration and
-- spam vector. The new endpoint checks and increments a counter here inside the
-- same transaction as the send.
--
-- `key` is of the form 'email:user:<id>' or 'email:global'.
-- --------------------------------------------------------------------------
create table if not exists rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  count         integer not null default 0
);

-- Per the note in sql_v2_migration.sql, tables created after 2026-10-30 need
-- explicit grants; service_role only, matching every other table in this app.
grant select, insert, update, delete on table rate_limits to service_role;
