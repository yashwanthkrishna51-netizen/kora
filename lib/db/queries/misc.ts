import { and, asc, desc, eq, gte, lte, ilike, sql } from "drizzle-orm";
import { appSettings, portfolioSnapshots, auditLog, users } from "@/lib/db/schema";
import { DEFAULT_CAPACITY_WEIGHTS } from "@/lib/domain/constants";
import type { AnyDb } from "@/lib/auth/db-types";

/** Settings, snapshots and the audit log. */

export interface CapacityWeights {
  module: number;
  pmo: number;
  ams: number;
  cap: number;
}

/**
 * Capacity weights drive the dashboard's team-bandwidth tile.
 *
 * Readable by any signed-in user: the numbers are a scoring configuration, and
 * the tile that consumes them is rendered client-side.
 */
export async function getCapacityWeights(db: AnyDb): Promise<CapacityWeights> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "capacity_weights"))
    .limit(1);

  const stored = (row?.value ?? {}) as Partial<CapacityWeights>;
  // Merged over the defaults so a partially-written row cannot produce NaN in
  // the tile — a missing weight silently becomes undefined otherwise.
  return { ...DEFAULT_CAPACITY_WEIGHTS, ...stored };
}

/**
 * ADMIN ONLY.
 *
 * The old GET had no role check at all, so any viewer could read the internal
 * distribution list — a list of colleagues' email addresses. That was one of
 * the flagged gaps; the gate lives on the route, and this comment is here so
 * nobody re-exposes it by reaching for the function from somewhere public.
 */
export async function getDigestRecipients(
  db: AnyDb,
): Promise<{ emails: string[] }> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "digest_recipients"))
    .limit(1);

  const stored = (row?.value ?? {}) as { emails?: unknown };
  return {
    emails: Array.isArray(stored.emails)
      ? stored.emails.filter((e): e is string => typeof e === "string")
      : [],
  };
}

export interface SnapshotRow {
  snapshotDate: string;
  clientId: string;
  clientName: string;
  integTotal: number | null;
  integAtRisk: number | null;
  integInProgress: number | null;
  integCompleted: number | null;
  implRag: string | null;
  implTotalPhases: number | null;
  implCompletedPhases: number | null;
  amsRag: string | null;
  amsOpenEntries: number | null;
  amsOpenL3l4: number | null;
  /** Financial. Present only for admins. */
  amsHoursMonth?: number | null;
  overallRag: string | null;
}

/**
 * Portfolio snapshots, for the dashboard's trend arrows.
 *
 * `ams_hours_month` is stripped for non-admins — it is billable-hours data,
 * and the old app stripped it too. Removed from the object rather than nulled,
 * so its absence is unambiguous rather than looking like "no hours logged".
 */
export async function listSnapshots(
  db: AnyDb,
  opts: { from?: string; to?: string; clientId?: string; isAdmin: boolean },
): Promise<SnapshotRow[]> {
  const conditions = [
    opts.from ? gte(portfolioSnapshots.snapshotDate, opts.from) : undefined,
    opts.to ? lte(portfolioSnapshots.snapshotDate, opts.to) : undefined,
    opts.clientId ? eq(portfolioSnapshots.clientId, opts.clientId) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(portfolioSnapshots)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(portfolioSnapshots.snapshotDate));

  return rows.map((r) => {
    const base: SnapshotRow = {
      snapshotDate: r.snapshotDate,
      clientId: r.clientId,
      clientName: r.clientName,
      integTotal: r.integTotal,
      integAtRisk: r.integAtRisk,
      integInProgress: r.integInProgress,
      integCompleted: r.integCompleted,
      implRag: r.implRag,
      implTotalPhases: r.implTotalPhases,
      implCompletedPhases: r.implCompletedPhases,
      amsRag: r.amsRag,
      amsOpenEntries: r.amsOpenEntries,
      amsOpenL3l4: r.amsOpenL3l4,
      overallRag: r.overallRag,
    };
    if (opts.isAdmin) {
      base.amsHoursMonth =
        r.amsHoursMonth === null ? null : Number(r.amsHoursMonth);
    }
    return base;
  });
}

export interface AuditQuery {
  from?: string;
  to?: string;
  user?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * Audit log. Admin only.
 *
 * Capped at 200 per page — the table is append-only and never pruned, so an
 * unbounded query grows without limit. The total is returned alongside so the
 * UI can paginate without a second round trip.
 */
export async function listAudit(db: AnyDb, q: AuditQuery) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = Math.max(q.offset ?? 0, 0);

  const conditions = [
    q.from ? gte(auditLog.ts, q.from) : undefined,
    q.to ? lte(auditLog.ts, q.to) : undefined,
    q.user ? eq(auditLog.username, q.user) : undefined,
    q.q ? ilike(auditLog.action, `%${q.q}%`) : undefined,
  ].filter(Boolean);

  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.ts))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(where),
  ]);

  return { rows, total, limit, offset };
}

/**
 * Names and emails, for the digest's assignee matching.
 *
 * Deliberately NOT `listUsersForAdmin`: that pulls lockout state and failed
 * attempt counts into a scheduled job which has no business with them, and a
 * cron is exactly the kind of caller that quietly grows access nobody reviews.
 */
export async function getDigestUserDirectory(
  db: AnyDb,
): Promise<{ name: string; email: string }[]> {
  const rows = await db
    .select({ name: users.name, email: users.email })
    .from(users);

  return rows
    .filter((r): r is { name: string; email: string } => !!r.email)
    .map((r) => ({ name: r.name, email: r.email }));
}
