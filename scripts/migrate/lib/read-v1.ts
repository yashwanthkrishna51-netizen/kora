import type { Client } from "@/lib/domain/types";
import type { Executor } from "./executor";

/**
 * Reads the v1 `clients` table into the shape the mapper expects.
 *
 * Shared by preflight, backfill, verify and the tests so there is exactly one
 * place that knows how a v1 row becomes a client object — in particular, one
 * place that preserves the null-sentinel.
 *
 * Timestamps are cast to explicit ISO text and numerics to float8 in SQL, so
 * the result does not depend on driver type mapping. postgres.js and PGlite
 * disagree about numerics otherwise, and the migration must not.
 */

export interface V1Row {
  id: string;
  name: string | null;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
  integrations: unknown;
  modules: unknown;
  work_log: unknown;
  man_day_rate: number | null;
  total_available_hours: number | null;
  currency: string | null;
  master_assignee: string | null;
}

export type V1Client = Client & {
  createdAt?: string;
  updatedAt?: string;
};

export const V1_SELECT = `
  select
    id,
    name,
    description,
    to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
    to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
    integrations,
    modules,
    work_log,
    man_day_rate::float8          as man_day_rate,
    total_available_hours::float8 as total_available_hours,
    currency,
    master_assignee
  from clients
  order by id asc
`;

/** jsonb may arrive parsed (postgres.js) or as text (some drivers). */
function asJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function rowToClient(r: V1Row): V1Client {
  const c: V1Client = {
    id: r.id,
    name: r.name ?? "",
    description: r.description ?? undefined,
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    integrations: (asJson(r.integrations) as Client["integrations"]) ?? [],
    currency: (r.currency as Client["currency"]) ?? "INR",
    masterAssignee: r.master_assignee ?? undefined,
    manDayRate: r.man_day_rate ?? undefined,
    totalAvailableHours: r.total_available_hours ?? undefined,
  };

  // THE SENTINEL. Attach the key only when the column is non-null, mirroring
  // api/read.js:54-55. Setting it to `undefined` would not be equivalent —
  // the old frontend tested `c.modules !== undefined`, so presence is the
  // signal, and losing it silently drops the client out of that domain's view.
  if (r.modules !== null && r.modules !== undefined) {
    c.modules = asJson(r.modules) as Client["modules"];
  }
  if (r.work_log !== null && r.work_log !== undefined) {
    c.workLog = asJson(r.work_log) as Client["workLog"];
  }

  return c;
}

export async function readV1Clients(exec: Executor): Promise<V1Client[]> {
  const rows = await exec.query<V1Row>(V1_SELECT);
  return rows.map(rowToClient);
}

/** Reads every v2 table for one client — verify's inverse leg. */
export async function readV2Snapshot(exec: Executor, clientId: string) {
  const [client] = await exec.query<Record<string, unknown>>(
    `select * from clients_v2 where id = $1`,
    [clientId],
  );
  const [integrations, milestones, modules, phases, workLog] = await Promise.all(
    [
      exec.query<Record<string, unknown>>(
        `select * from integrations_v2 where client_id = $1`, [clientId]),
      exec.query<Record<string, unknown>>(
        `select * from milestones_v2 where client_id = $1`, [clientId]),
      exec.query<Record<string, unknown>>(
        `select * from modules_v2 where client_id = $1`, [clientId]),
      exec.query<Record<string, unknown>>(
        `select * from phases_v2 where client_id = $1`, [clientId]),
      exec.query<Record<string, unknown>>(
        `select * from ams_work_log_v2 where client_id = $1`, [clientId]),
    ],
  );
  return { client, integrations, milestones, modules, phases, workLog };
}
