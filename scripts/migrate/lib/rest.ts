import type { V1Client, V1Row } from "./read-v1";
import { rowToClient } from "./read-v1";

/**
 * Reads v1 data through PostgREST instead of a direct Postgres connection.
 *
 * WHY BOTH EXIST
 *
 * The Supabase project URL + service-role key are already provisioned (the old
 * app uses exactly these), whereas the database password is a separate secret
 * that often nobody has to hand. PostgREST is entirely adequate for reading, so
 * preflight can run — and produce the data-cleanup list, which is the item with
 * the longest human lead time — without waiting on that.
 *
 * It is NOT adequate for the migration itself: no transactions, no TRUNCATE, no
 * DDL. The backfill deliberately runs as one all-or-nothing transaction, which
 * PostgREST cannot express, so that path keeps requiring a real connection.
 * This module is therefore read-only by construction.
 *
 * The service-role key bypasses row-level security completely. It is as
 * sensitive as the database password.
 */

export interface RestConfig {
  url: string;
  key: string;
}

export function resolveRest(): RestConfig | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

function headers(key: string, extra: Record<string, string> = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    ...extra,
  };
}

/**
 * Fetches a table in pages.
 *
 * PostgREST caps a response at its configured maximum (1000 rows by default),
 * and does so silently — you get a 200 with a truncated body. A migration that
 * quietly reads only the first 1000 clients would be a catastrophic way to
 * discover that, so this pages explicitly via Range and keeps going until a
 * short page arrives.
 */
async function fetchAll<T>(
  cfg: RestConfig,
  table: string,
  select = "*",
  pageSize = 500,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;

  for (;;) {
    const to = from + pageSize - 1;
    const res = await fetch(
      `${cfg.url}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=id.asc`,
      { headers: headers(cfg.key, { Range: `${from}-${to}` }) },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `PostgREST ${res.status} reading ${table}: ${body.slice(0, 300)}`,
      );
    }

    const page = (await res.json()) as T[];
    out.push(...page);

    if (page.length < pageSize) return out;
    from += pageSize;
  }
}

export async function readV1ClientsViaRest(
  cfg: RestConfig,
): Promise<V1Client[]> {
  const rows = await fetchAll<Record<string, unknown>>(cfg, "clients");

  return rows.map((r) =>
    rowToClient({
      id: String(r.id),
      name: (r.name as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      created_at: (r.created_at as string | null) ?? null,
      updated_at: (r.updated_at as string | null) ?? null,
      integrations: r.integrations,
      // PostgREST omits nothing, so a null column arrives as null — the
      // sentinel survives, which is the one thing that must not be lost here.
      modules: r.modules ?? null,
      work_log: r.work_log ?? null,
      man_day_rate:
        r.man_day_rate === null || r.man_day_rate === undefined
          ? null
          : Number(r.man_day_rate),
      total_available_hours:
        r.total_available_hours === null || r.total_available_hours === undefined
          ? null
          : Number(r.total_available_hours),
      currency: (r.currency as string | null) ?? null,
      master_assignee: (r.master_assignee as string | null) ?? null,
    } satisfies V1Row),
  );
}

/** Confirms the key works and the v1 table is reachable, before any real work. */
export async function probeRest(cfg: RestConfig): Promise<number> {
  const res = await fetch(
    `${cfg.url}/rest/v1/clients?select=id&limit=1`,
    { headers: headers(cfg.key, { Prefer: "count=exact", Range: "0-0" }) },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `PostgREST ${res.status}: ${body.slice(0, 300)}\n` +
        `  Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`,
    );
  }
  // content-range looks like "0-0/23"; the total is what we want.
  const total = res.headers.get("content-range")?.split("/")[1];
  return total ? Number(total) : 0;
}
