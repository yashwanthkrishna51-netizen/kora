-- ============================================================================
-- 0003 — EXPLICIT DOMAIN MEMBERSHIP on clients_v2
-- ============================================================================
-- WHY THIS EXISTS
--
-- v1 encodes which delivery domains a client belongs to in the NULL-ness of
-- two jsonb columns, not in any flag:
--
--     clients.modules  IS NULL   -> client is NOT in the Implementation domain
--     clients.modules  = '[]'    -> client IS in the domain, with zero modules
--
-- and identically for clients.work_log / the AMS domain. api/read.js:54-55
-- reconstructs this by only attaching the key when the column is non-null, and
-- the frontend then tests `c.modules !== undefined` to decide domain membership.
--
-- v2 stores modules and work-log entries as rows, and "zero rows" cannot
-- distinguish those two cases. Without this migration, every client with an
-- empty-but-present domain would silently drop out of the Implementation or
-- AMS view at cutover — a real, user-visible data loss even though no record
-- was actually lost.
--
-- Booleans rather than a client_domains join table: there are exactly two
-- optional domains (Integrations is universal — read.js always emits it), and
-- flags keep every list query join-free.
--
-- Safe to apply while the old app is still running: dual-write never writes
-- these columns and the defaults are false. The backfill sets the real values.
-- ============================================================================

alter table clients_v2
  add column if not exists has_implementation boolean not null default false,
  add column if not exists has_ams            boolean not null default false;

comment on column clients_v2.has_implementation is
  'v1 sentinel: clients.modules IS NOT NULL. True with zero modules_v2 rows means in-domain but empty.';

comment on column clients_v2.has_ams is
  'v1 sentinel: clients.work_log IS NOT NULL. True with zero ams_work_log_v2 rows means in-domain but empty.';

-- Partial indexes for the domain-scoped list queries (/implementation, /ams).
create index if not exists idx_clients_v2_has_impl
  on clients_v2 (has_implementation) where archived = false;

create index if not exists idx_clients_v2_has_ams
  on clients_v2 (has_ams) where archived = false;
