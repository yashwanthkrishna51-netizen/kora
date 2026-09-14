-- ============================================================================
-- KORA — NORMALIZED SCHEMA v2 (Postgres/Supabase native, optimized)
-- ============================================================================
-- Run this in Supabase SQL editor BEFORE deploying any dual-write code that
-- depends on it. Only `clients` has the jsonb-blob-of-records problem —
-- confirmed by inspecting every table in use (users/audit_log/
-- portfolio_snapshots/app_settings/login_ip_throttle are already flat).
--
-- GRANTS: service_role only, deliberately — confirmed by checking the app
-- itself that nothing ever uses Supabase's anon key or authenticated role
-- (every api/*.js call uses the service-role key exclusively). Granting
-- anon/authenticated here would be unnecessary exposure with zero
-- functional benefit, especially since RLS is disabled by design on this
-- project — don't widen these back "to match the other tables" without
-- re-checking whether the app actually needs it, same way this file did.
-- ============================================================================

create table if not exists clients_v2 (
  id                      text primary key,
  name                    text not null,
  description             text default '',
  man_day_rate            numeric,
  total_available_hours   numeric,
  currency                text not null default 'INR',
  master_assignee         text,
  archived                boolean not null default false,
  archived_at             timestamptz,
  archived_by             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_clients_v2_archived on clients_v2 (archived);
create index if not exists idx_clients_v2_name on clients_v2 (name);
grant select, insert, update, delete on table clients_v2 to service_role;

create table if not exists integrations_v2 (
  id              text primary key,
  client_id       text not null references clients_v2(id) on delete restrict,
  name            text not null,
  status          text not null default 'Not Started',
  assignee        text,
  due_date        date,
  description     text default '',
  next_action     text default '',
  effort_weight   numeric not null default 0.5,
  activity_log    jsonb not null default '[]',
  archived        boolean not null default false,
  archived_at     timestamptz,
  archived_by     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_integrations_v2_client on integrations_v2 (client_id) where archived = false;
create index if not exists idx_integrations_v2_status on integrations_v2 (status) where archived = false;
create index if not exists idx_integrations_v2_due on integrations_v2 (due_date) where archived = false;
grant select, insert, update, delete on table integrations_v2 to service_role;

create table if not exists milestones_v2 (
  id              text primary key,
  integration_id  text not null references integrations_v2(id) on delete restrict,
  client_id       text not null references clients_v2(id) on delete restrict,
  name            text not null,
  status          text not null default 'Pending',
  due_date        date,
  owner           text,
  notes           text default '',
  archived        boolean not null default false,
  archived_at     timestamptz,
  archived_by     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_milestones_v2_integration on milestones_v2 (integration_id) where archived = false;
create index if not exists idx_milestones_v2_client on milestones_v2 (client_id) where archived = false;
grant select, insert, update, delete on table milestones_v2 to service_role;

create table if not exists modules_v2 (
  id              text primary key,
  client_id       text not null references clients_v2(id) on delete restrict,
  name            text not null,
  archived        boolean not null default false,
  archived_at     timestamptz,
  archived_by     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_modules_v2_client on modules_v2 (client_id) where archived = false;
grant select, insert, update, delete on table modules_v2 to service_role;

create table if not exists phases_v2 (
  id                text primary key,
  module_id         text not null references modules_v2(id) on delete restrict,
  client_id         text not null references clients_v2(id) on delete restrict,
  phase_name        text not null,
  status            text not null default 'Not Started',
  assignee          text,
  start_date        date,
  target_date       date,
  current_activity  text default '',
  next_action       text default '',
  activity_log      jsonb not null default '[]',
  archived          boolean not null default false,
  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists uq_phases_v2_module_phasename_active
  on phases_v2 (module_id, phase_name) where archived = false;
create index if not exists idx_phases_v2_client on phases_v2 (client_id) where archived = false;
create index if not exists idx_phases_v2_status on phases_v2 (status) where archived = false;
grant select, insert, update, delete on table phases_v2 to service_role;

create table if not exists ams_work_log_v2 (
  id              text primary key,
  client_id       text not null references clients_v2(id) on delete restrict,
  date_raised     date not null,
  due_date        date,
  raised_by       text,
  module          text,
  project         text,
  description     text default '',
  entry_type      text,
  query_level     text,
  entry_status    text not null default 'Open',
  rag_status      text,
  mode_of_support text,
  dependencies    text default '',
  solution        text default '',
  hours           numeric not null default 0,
  edit_history    jsonb not null default '[]',
  archived        boolean not null default false,
  archived_at     timestamptz,
  archived_by     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_ams_work_log_v2_client on ams_work_log_v2 (client_id) where archived = false;
create index if not exists idx_ams_work_log_v2_status on ams_work_log_v2 (entry_status) where archived = false;
create index if not exists idx_ams_work_log_v2_date on ams_work_log_v2 (date_raised);
grant select, insert, update, delete on table ams_work_log_v2 to service_role;