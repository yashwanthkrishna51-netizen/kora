-- ============================================================================
-- 0004 — CASE-INSENSITIVE UNIQUE CLIENT NAME
-- ============================================================================
-- v1 has no uniqueness on clients.name, and the old app only checks for
-- duplicates against the array already in the browser's memory. Two people (or
-- one stale tab) could therefore create two clients with the same name — which
-- is exactly the situation behind the duplicate "Anand" client row in the prior
-- data-loss incident.
--
-- ORDERING — THIS FILE IS A GATE, NOT A FIX
--
-- Apply this ONLY after `pnpm migrate:preflight` reports zero duplicate names.
-- If duplicates still exist the CREATE INDEX fails, and that failure is the
-- point: duplicates must be resolved BY A HUMAN in the old app (rename, or
-- merge the records by hand and delete the empty one). Never auto-merge —
-- picking a winner programmatically is how records get silently lost.
--
-- Scoped to active rows so an archived client never blocks reuse of its name.
-- lower(trim(...)) rather than the citext extension, to avoid a dependency.
-- ============================================================================

create unique index if not exists uq_clients_v2_name_ci_active
  on clients_v2 (lower(trim(name)))
  where archived = false;

-- Verify before applying:
--
--   select lower(trim(name)) as key,
--          count(*)          as n,
--          array_agg(id order by created_at) as ids
--   from clients
--   group by 1
--   having count(*) > 1;
--
-- Zero rows means this migration will apply cleanly.
