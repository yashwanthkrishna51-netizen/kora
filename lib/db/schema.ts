import {
  pgTable,
  text,
  boolean,
  timestamp,
  numeric,
  date,
  jsonb,
  integer,
  bigserial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ActivityEntry,
  Integration,
  Module,
  WorkLogEntry,
} from "@/lib/domain/types";

/**
 * The database contract.
 *
 * Hand-written to match the live schema rather than generated, because the v1
 * side has no DDL anywhere except the production database and the v2 side was
 * applied by hand from sql_v2_migration.sql. This file is the first complete
 * schema-as-code artefact for the project, and is shared by the migration
 * tooling and the application so the two can't drift.
 *
 * TIMESTAMP MODE IS LOAD-BEARING. Every `updated_at` here uses
 * `mode: "string"`, because that column doubles as the optimistic-concurrency
 * token (`_v`): the client echoes it back and the UPDATE matches on equality.
 * Round-tripping through a JS `Date` truncates sub-millisecond precision, so a
 * stored microsecond value could never match and every save would 409.
 */

/* ==========================================================================
   v1 — the live source of truth until cutover.
   Read-only from this codebase: the migration reads it, nothing writes it.
   ========================================================================== */

export const clientsV1 = pgTable("clients", {
  id: text("id").primaryKey(),
  name: text("name"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),

  /**
   * Domain membership in v1 is a null-sentinel, not a flag:
   *   modules === null  -> client is NOT in the Implementation domain
   *   modules === []    -> client IS in the domain, with zero modules
   * The same applies to work_log for AMS. v2 cannot express this with rows
   * alone, which is why clients_v2 gains explicit booleans.
   */
  integrations: jsonb("integrations").$type<Integration[]>(),
  modules: jsonb("modules").$type<Module[] | null>(),
  workLog: jsonb("work_log").$type<WorkLogEntry[] | null>(),

  manDayRate: numeric("man_day_rate"),
  totalAvailableHours: numeric("total_available_hours"),
  currency: text("currency"),
  masterAssignee: text("master_assignee"),
});

/* ==========================================================================
   v2 — normalized. Soft-delete only; nothing here is ever hard-deleted by the
   application. All FKs are `on delete restrict`, which is why the migration's
   rebuild truncates all six tables in a single statement.
   ========================================================================== */

/** Columns every v2 table carries. Spread into each definition. */
const archival = {
  archived: boolean("archived").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" }),
  archivedBy: text("archived_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
};

export const clients = pgTable(
  "clients_v2",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").default(""),
    manDayRate: numeric("man_day_rate"),
    totalAvailableHours: numeric("total_available_hours"),
    currency: text("currency").notNull().default("INR"),
    masterAssignee: text("master_assignee"),

    /** Added by migration 0003 — recovers the v1 null-sentinel. */
    hasImplementation: boolean("has_implementation").notNull().default(false),
    hasAms: boolean("has_ams").notNull().default(false),

    ...archival,
  },
  (t) => [
    index("idx_clients_v2_archived").on(t.archived),
    index("idx_clients_v2_name").on(t.name),
    // Migration 0004. Case-insensitive, active rows only, so an archived
    // client never blocks reuse of its name.
    uniqueIndex("uq_clients_v2_name_ci_active")
      .on(sql`lower(trim(${t.name}))`)
      .where(sql`${t.archived} = false`),
  ],
);

export const integrations = pgTable(
  "integrations_v2",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("Not Started"),
    assignee: text("assignee"),
    dueDate: date("due_date"),
    description: text("description").default(""),
    nextAction: text("next_action").default(""),
    effortWeight: numeric("effort_weight").notNull().default("0.5"),
    /** v1 `timeline`. Stays jsonb: entries are append-only and self-timestamped. */
    activityLog: jsonb("activity_log")
      .$type<ActivityEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...archival,
  },
  (t) => [
    index("idx_integrations_v2_client")
      .on(t.clientId)
      .where(sql`${t.archived} = false`),
    index("idx_integrations_v2_status")
      .on(t.status)
      .where(sql`${t.archived} = false`),
    index("idx_integrations_v2_due")
      .on(t.dueDate)
      .where(sql`${t.archived} = false`),
  ],
);

export const milestones = pgTable(
  "milestones_v2",
  {
    id: text("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "restrict" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("Pending"),
    dueDate: date("due_date"),
    owner: text("owner"),
    notes: text("notes").default(""),
    ...archival,
  },
  (t) => [
    index("idx_milestones_v2_integration")
      .on(t.integrationId)
      .where(sql`${t.archived} = false`),
    index("idx_milestones_v2_client")
      .on(t.clientId)
      .where(sql`${t.archived} = false`),
  ],
);

export const modules = pgTable(
  "modules_v2",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    ...archival,
  },
  (t) => [
    index("idx_modules_v2_client")
      .on(t.clientId)
      .where(sql`${t.archived} = false`),
  ],
);

export const phases = pgTable(
  "phases_v2",
  {
    id: text("id").primaryKey(),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "restrict" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    phaseName: text("phase_name").notNull(),
    status: text("status").notNull().default("Not Started"),
    assignee: text("assignee"),
    startDate: date("start_date"),
    targetDate: date("target_date"),
    currentActivity: text("current_activity").default(""),
    nextAction: text("next_action").default(""),
    /** v1 `updates`. */
    activityLog: jsonb("activity_log")
      .$type<ActivityEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...archival,
  },
  (t) => [
    // One active row per (module, phase name) — the migration must therefore
    // gate on duplicate phase names within a module.
    uniqueIndex("uq_phases_v2_module_phasename_active")
      .on(t.moduleId, t.phaseName)
      .where(sql`${t.archived} = false`),
    index("idx_phases_v2_client")
      .on(t.clientId)
      .where(sql`${t.archived} = false`),
    index("idx_phases_v2_status")
      .on(t.status)
      .where(sql`${t.archived} = false`),
  ],
);

export const amsWorkLog = pgTable(
  "ams_work_log_v2",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    /**
     * NOT NULL. The old dual-write passed `e.dateRaised` through with no
     * fallback, so any v1 entry missing it has been silently failing the
     * shadow write. The migration applies an explicit fallback chain instead.
     */
    dateRaised: date("date_raised").notNull(),
    dueDate: date("due_date"),
    raisedBy: text("raised_by"),
    module: text("module"),
    project: text("project"),
    description: text("description").default(""),
    /** v1 `type`. */
    entryType: text("entry_type"),
    queryLevel: text("query_level"),
    entryStatus: text("entry_status").notNull().default("Open"),
    ragStatus: text("rag_status"),
    modeOfSupport: text("mode_of_support"),
    dependencies: text("dependencies").default(""),
    solution: text("solution").default(""),
    hours: numeric("hours").notNull().default("0"),
    /** v1 `edits`. */
    editHistory: jsonb("edit_history")
      .$type<WorkLogEntry["edits"]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...archival,
  },
  (t) => [
    index("idx_ams_work_log_v2_client")
      .on(t.clientId)
      .where(sql`${t.archived} = false`),
    index("idx_ams_work_log_v2_status")
      .on(t.entryStatus)
      .where(sql`${t.archived} = false`),
    index("idx_ams_work_log_v2_date").on(t.dateRaised),
  ],
);

/* ==========================================================================
   Flat tables — already normalized in v1 and carried over unchanged.
   ========================================================================== */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    name: text("name").notNull(),
    email: text("email").default(""),
    role: text("role").notNull().default("viewer"),
    /** bcrypt ($2a/$2b/$2y) or a legacy SHA-256 hex digest, rehashed on login. */
    passwordHash: text("password_hash").notNull(),
    tokenVersion: integer("token_version").notNull().default(0),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockoutLevel: integer("lockout_level").notNull().default(0),
    lockedUntil: timestamp("locked_until", {
      withTimezone: true,
      mode: "string",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    // Migration 0005. The old login used `username=eq.` which is
    // case-sensitive; the new one lowercases both sides and needs this.
    uniqueIndex("uq_users_username_ci").on(sql`lower(${t.username})`),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    // bigserial — verified against the live database. The writer never sends
    // id or ts, so declaring the default here keeps them out of insert types.
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    actorId: text("actor_id"),
    username: text("username"),
    role: text("role"),
    action: text("action").notNull(),
    entity: text("entity"),
    screen: text("screen"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    // Migration 0005 — the audit view sorts by ts desc and filters by user.
    index("idx_audit_log_ts").on(sql`${t.ts} desc`),
    index("idx_audit_log_username_ts").on(t.username, sql`${t.ts} desc`),
  ],
);

export const loginIpThrottle = pgTable("login_ip_throttle", {
  ip: text("ip").primaryKey(),
  attemptCount: integer("attempt_count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  lockedUntil: timestamp("locked_until", {
    withTimezone: true,
    mode: "string",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  // Surrogate key; (snapshot_date, client_id) carries a UNIQUE constraint and
  // is what api/snapshot.js upserts on — it is not the primary key.
  id: bigserial("id", { mode: "number" }).primaryKey(),
  snapshotDate: date("snapshot_date").notNull(),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  integTotal: integer("integ_total"),
  integAtRisk: integer("integ_at_risk"),
  integInProgress: integer("integ_in_progress"),
  integCompleted: integer("integ_completed"),
  implRag: text("impl_rag"),
  implTotalPhases: integer("impl_total_phases"),
  implCompletedPhases: integer("impl_completed_phases"),
  amsRag: text("ams_rag"),
  amsOpenEntries: integer("ams_open_entries"),
  amsOpenL3l4: integer("ams_open_l3l4"),
  /** Financial — stripped from the response for non-admins. */
  amsHoursMonth: numeric("ams_hours_month"),
  overallRag: text("overall_rag"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedBy: text("updated_by"),
});

/**
 * Fixed-window rate limiting (migration 0005). Introduced because the old
 * send-client-email endpoint let any editor mail an arbitrary attachment to an
 * arbitrary address from the corporate mailbox, unbounded.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", {
    withTimezone: true,
    mode: "string",
  }).notNull(),
  count: integer("count").notNull().default(0),
});

export const schema = {
  clientsV1,
  clients,
  integrations,
  milestones,
  modules,
  phases,
  amsWorkLog,
  users,
  auditLog,
  loginIpThrottle,
  portfolioSnapshots,
  appSettings,
  rateLimits,
};
