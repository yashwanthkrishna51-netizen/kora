-- 0006 — updated_at maintained by the database, not by the application.
--
-- `updated_at` is the optimistic-concurrency token: a GET hands it out as
-- `_v`, a PATCH echoes it in If-Match, and the UPDATE matches on equality. The
-- whole scheme rests on that column advancing on every write.
--
-- Nothing advanced it. The v2 tables default it to now() on INSERT and leave
-- it alone on UPDATE, so it was up to every statement in the application to
-- remember `set updated_at = now()`. Forgetting it in one place does not fail
-- loudly — the write succeeds, the token simply stops changing, and from then
-- on concurrent edits to that entity overwrite each other silently while
-- If-Match keeps returning 200. That is the exact bug OCC exists to prevent.
--
-- A trigger cannot be forgotten. It also stops a client from pinning the
-- column by sending its own value, since the trigger overwrites whatever the
-- statement supplied.
--
-- UPDATE only. The backfill preserves v1 timestamps on INSERT and must keep
-- doing so, or re-running it would no longer be idempotent.
--
-- Idempotent; safe to re-run.

create or replace function set_updated_at() returns trigger as $$
begin
  -- clock_timestamp(), not now(): now() is transaction-start time and is
  -- constant for the whole transaction, so two updates to one row inside a
  -- single transaction would produce the same token twice.
  new.updated_at = clock_timestamp();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients_v2',
    'integrations_v2',
    'milestones_v2',
    'modules_v2',
    'phases_v2',
    'ams_work_log_v2',
    'users'
  ]
  loop
    if to_regclass(t) is not null then
      execute format('drop trigger if exists trg_%s_updated_at on %I', t, t);
      execute format(
        'create trigger trg_%s_updated_at before update on %I
           for each row execute function set_updated_at()', t, t);
    end if;
  end loop;
end $$;
