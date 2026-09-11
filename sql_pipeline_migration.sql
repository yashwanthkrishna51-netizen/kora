-- ═══════════════════════════════════════════════════════════════════
-- Kora — Sales Pipeline migration
-- Run this ONCE in the Supabase SQL Editor (Project → SQL Editor → New query)
-- before deploying the pipeline code. Nothing in the app works without this.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists pipeline_entries (
  id                    text primary key,           -- client-generated via uid(), same convention as every other Kora id
  name                  text not null,               -- deal / opportunity name
  client_id             text references clients(id), -- set if this is an existing Kora client; null for a new prospect
  prospect_name         text,                        -- used only when client_id is null
  stage                 text not null default 'Lead', -- Lead / Qualified / Proposal Sent / Negotiation / Won / Lost
  probability           numeric not null default 10,  -- win probability %, defaults from stage config, editable per-deal
  owner                 text,                        -- assignee name — matches the existing assigneeSelect() dropdown pattern
  estimated_hours       numeric,
  quoted_value          numeric,                     -- ₹ quoted amount
  lead_source           text,                        -- Referral / Inbound / Existing Client Expansion / Cold Outreach / Other
  target_domain         text,                        -- Integration / Implementation / Both — what this becomes if won
  expected_close_date   date,
  next_action           text,
  notes                 text,
  win_loss_reason       text,                        -- captured when moved to Won or Lost
  won_at                timestamptz,                 -- set when moved to Integration/Implementation — entry stays as history, never deleted
  last_activity_at      timestamptz not null default now(),  -- bumped on every real edit — powers the existing isStale()/staleBadge() "deal rotting" logic, reused as-is
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),  -- OCC guard, same conditional-PATCH pattern as write.js
  updated_by            text
);

create index if not exists idx_pipeline_entries_stage on pipeline_entries(stage);
create index if not exists idx_pipeline_entries_client on pipeline_entries(client_id);

-- Row Level Security: service-role key (used by all of Kora's api/*.js) bypasses
-- RLS entirely, matching how every other Kora table already works — this is
-- just the standard baseline so the table isn't left wide open if anon/public
-- keys are ever used against it.
alter table pipeline_entries enable row level security;
