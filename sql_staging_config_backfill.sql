-- ═══════════════════════════════════════════════════════════════════
-- One-time backfill: add the "Staging Config" phase to every existing
-- Implementation module, immediately after "BPU Signoff".
--
-- Why: Staging Config was added to PHASES in js/core.js (commit 8f1747d).
-- Modules created before that have no stored entry for it. The app already
-- fills it in memory on load (normalizeModulePhases) and writes it on the
-- client's next save; this script writes it into every row now instead.
--
-- Touches only modules that: are not Governance (singlePhase), have a
-- "BPU Signoff" phase, and have no "Staging Config" phase yet. Pipeline
-- "Kickoff"-only modules and Governance are left alone. Safe to re-run —
-- a second run changes 0 rows.
--
-- Run in Supabase → SQL Editor, off-hours, one step at a time.
-- Afterwards ask everyone to hard-reload (open tabs keep old data).
-- ═══════════════════════════════════════════════════════════════════


-- ── STEP 1: backup ────────────────────────────────────────────────
-- Kept in a separate "backup" schema: PostgREST only exposes "public",
-- so this copy is never readable through the API keys.
create schema if not exists backup;
create table backup.clients_pre_staging_20261001 as table public.clients;
select count(*) as rows_backed_up from backup.clients_pre_staging_20261001;


-- ── STEP 2: preview (read-only) — which modules will change ───────
select c.name as client, m->>'name' as module
from public.clients c,
     jsonb_array_elements(c.modules) as m
where jsonb_typeof(c.modules) = 'array'
  and coalesce(m->>'singlePhase', 'false') <> 'true'
  and jsonb_typeof(m->'phases') = 'array'
  and exists (select 1 from jsonb_array_elements(m->'phases') p where p->>'name' = 'BPU Signoff')
  and not exists (select 1 from jsonb_array_elements(m->'phases') p where p->>'name' = 'Staging Config')
order by 1, 2;


-- ── STEP 3: update ────────────────────────────────────────────────
begin;

create or replace function pg_temp.needs_staging(m jsonb) returns boolean
language sql immutable as $$
  select coalesce(m->>'singlePhase', 'false') <> 'true'
     and jsonb_typeof(m->'phases') = 'array'
     and exists (select 1 from jsonb_array_elements(m->'phases') p where p->>'name' = 'BPU Signoff')
     and not exists (select 1 from jsonb_array_elements(m->'phases') p where p->>'name' = 'Staging Config');
$$;

-- Rebuilds a module's phases with Staging Config inserted right after
-- BPU Signoff; every other phase keeps its position.
create or replace function pg_temp.with_staging(m jsonb) returns jsonb
language sql immutable as $$
  select jsonb_set(m, '{phases}', (
    select jsonb_agg(x order by o, sub)
    from (
      select p as x, o, 0 as sub
      from jsonb_array_elements(m->'phases') with ordinality as t(p, o)
      union all
      select '{"name":"Staging Config","status":"Not Started","startDate":"","targetDate":"","updates":[]}'::jsonb,
             (select o from jsonb_array_elements(m->'phases') with ordinality as t2(p, o)
              where p->>'name' = 'BPU Signoff' limit 1),
             1
    ) s
  ));
$$;

update public.clients c
set modules = (
      select jsonb_agg(case when pg_temp.needs_staging(m) then pg_temp.with_staging(m) else m end order by ord)
      from jsonb_array_elements(c.modules) with ordinality as e(m, ord)
    ),
    -- Bumped so any open tab gets a 409 on its next save of this client and
    -- heals from fresh data, instead of overwriting the new phase.
    updated_at = now()
where jsonb_typeof(c.modules) = 'array'
  and exists (select 1 from jsonb_array_elements(c.modules) m where pg_temp.needs_staging(m));

-- Verify: must return 0 before you commit.
select count(*) as modules_still_missing
from public.clients c, jsonb_array_elements(c.modules) m
where jsonb_typeof(c.modules) = 'array' and pg_temp.needs_staging(m);

commit;   -- or: rollback;


-- ── ROLLBACK (only if needed, after commit) ───────────────────────
-- update public.clients c
-- set modules = b.modules, updated_at = now()
-- from backup.clients_pre_staging_20261001 b
-- where b.id = c.id;
--
-- Once everything looks right (a few days later):
-- drop table backup.clients_pre_staging_20261001;
