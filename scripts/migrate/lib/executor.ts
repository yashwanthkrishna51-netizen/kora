import type { Sql } from "postgres";

/**
 * A minimal SQL executor interface.
 *
 * The backfill and verify logic is written against this rather than against a
 * concrete driver, for one reason that matters: it lets the entire pipeline be
 * exercised end-to-end in-process against PGlite (real Postgres, WASM) in the
 * test suite, while the CLI runs the identical code against the live database
 * through postgres.js.
 *
 * The alternative — testing the logic with mocks and only ever running the real
 * thing against production — is how migrations go wrong.
 */

export interface Executor {
  /** Parameterized query using $1, $2, … placeholders. */
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
  /** Multi-statement DDL/SQL with no parameters. */
  exec(text: string): Promise<void>;
}

/**
 * Marks a parameter destined for a json/jsonb column.
 *
 * The two drivers need opposite things here, and getting it wrong is silent:
 *
 *   postgres.js inspects the statement's parameter types and JSON-serializes
 *   the value itself. Hand it a pre-stringified array and it stringifies the
 *   string, storing a jsonb *scalar string* rather than an array.
 *
 *   PGlite does no such serialization and needs the JSON text.
 *
 * Either mistake produces a column that still reads back as "valid JSON" via a
 * parser, so it survives naive round-trip checks while being the wrong shape
 * for every query the application will run against it. Wrapping the value makes
 * the intent explicit and lets each adapter do its own thing.
 */
export class JsonParam {
  constructor(readonly value: unknown) {}
}

/** postgres.js adapter — used by the CLI against a real server. */
export function fromPostgresJs(sql: Sql): Executor {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      // Hand postgres.js the raw value and let it serialize exactly once.
      const mapped = params.map((p) =>
        p instanceof JsonParam ? p.value : p,
      );
      const rows = await sql.unsafe(text, mapped as never[]);
      return rows as unknown as T[];
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
  };
}

/** PGlite adapter — used by the end-to-end tests. */
export function fromPglite(db: {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (text: string) => Promise<unknown>;
}): Executor {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      // PGlite wants the JSON text; it does not serialize objects itself.
      const mapped = params.map((p) =>
        p instanceof JsonParam ? JSON.stringify(p.value) : p,
      );
      const res = await db.query(text, mapped);
      return res.rows as T[];
    },
    async exec(text: string) {
      await db.exec(text);
    },
  };
}

/**
 * Inserts rows in batches using a single multi-VALUES statement per batch.
 *
 * Built by hand rather than reached for from an ORM because the column set is
 * fixed and known, and because a predictable single statement per batch is far
 * easier to reason about inside the one big transaction the backfill runs.
 */
export async function insertBatch(
  exec: Executor,
  table: string,
  columns: string[],
  // `object` rather than Record<string, unknown> so the concrete row
  // interfaces in mapping.ts can be passed without index signatures.
  rows: readonly object[],
  batchSize = 500,
): Promise<number> {
  if (!rows.length) return 0;

  let written = 0;

  for (let start = 0; start < rows.length; start += batchSize) {
    const chunk = rows.slice(start, start + batchSize);
    const params: unknown[] = [];
    const tuples: string[] = [];

    for (const row of chunk) {
      const record = row as Record<string, unknown>;
      const placeholders = columns.map((col) => {
        params.push(normalize(record[col]));
        return `$${params.length}`;
      });
      tuples.push(`(${placeholders.join(", ")})`);
    }

    const text =
      `insert into ${table} (${columns.map(quote).join(", ")}) ` +
      `values ${tuples.join(", ")}`;

    await exec.query(text, params);
    written += chunk.length;
  }

  return written;
}

function quote(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/** Objects and arrays are jsonb-bound; the adapter decides how to encode them. */
function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value !== null && typeof value === "object") return new JsonParam(value);
  return value;
}
