import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The application's database handle.
 *
 * Connects through Supabase's Supavisor pooler in TRANSACTION mode (6543),
 * which imposes two things:
 *
 *   prepare: false   transaction mode does not support prepared statements
 *
 * TLS must be stated explicitly. postgres.js does not infer it from the URL,
 * and without it Supabase's pooler rejects the handshake and reports
 * "password authentication failed" — an error that sends you looking for a
 * credential problem that does not exist. That cost real time on this project;
 * do not remove it.
 *
 * Interactive transactions work fine in transaction mode: Supavisor pins the
 * connection for the transaction's duration. Only prepared statements are out.
 */

export type Db = ReturnType<typeof createDb>;

function createDb(url: string) {
  /**
   * POOL SIZE IS NOT A CONSTANT — it depends on what is on the other end, and
   * `max: 1` behind the pooler was costing more than it saved.
   *
   * The reasoning for 1 was that Supavisor is itself the pool, so the client
   * needs only one connection. That is true of connection COUNT and wrong about
   * latency: `max` also caps how many queries one request may have in flight.
   * `getClientTrees` deliberately issues SIX queries in a single `Promise.all`
   * — one per table, assembled in memory, because walking the tree per client
   * is the whole response time — and `getClientTree` runs the same six for one
   * client, which is the query behind every detail screen. With `max: 1` those
   * six queue on one socket and run strictly serially.
   *
   * Measured, six parallel queries against the local Postgres with `pg_sleep`
   * standing in for a remote round trip:
   *
   *     per query   max:1    max:2    max:4    max:8
   *        10 ms     74 ms    44 ms    35 ms    23 ms
   *        30 ms    189 ms   104 ms    75 ms    45 ms
   *
   * So on a remote pooler `max: 1` was adding roughly 100 ms to every screen
   * that loads a client, for nothing. Four is the compromise: it collapses the
   * six into two rounds, and it is still a small enough per-instance footprint
   * that Supavisor's backend pool is not the thing under pressure. Higher is
   * faster here and worse under concurrency, which is not a trade to make
   * blind — this one is measured, the next one needs production numbers.
   */
  const pooled = /pooler\.supabase\.com|supavisor|pgbouncer/.test(url);

  const sql = postgres(url, {
    max: pooled ? 4 : 8,
    prepare: false,
    /**
     * KEEP THE CONNECTION, because opening one is not cheap.
     *
     * At 20 seconds, a low-traffic internal tool re-handshakes with Supavisor
     * on very nearly every navigation — TCP, then TLS, then auth, which is
     * several round trips before the first query is even sent. That was most of
     * a second while the functions ran in `iad1` and the database sat in
     * Mumbai; with both in `bom1` (see vercel.json) it is small, but it is
     * still several round trips bought for nothing.
     *
     * Three minutes covers someone clicking through a few screens without
     * holding sockets open across genuinely idle periods. Vercel freezes an
     * idle instance anyway, so this is an upper bound rather than a promise.
     */
    idle_timeout: 180,
    connect_timeout: 10,
    ssl: url.includes("localhost") || url.includes("127.0.0.1")
      ? false
      : "require",
    onnotice: () => {},
  });
  return drizzle(sql, { schema });
}

let cached: Db | undefined;

/**
 * Lazily created and reused across warm invocations. Lazy rather than
 * module-scope so that importing anything from this file does not require the
 * environment variable to be present — tests and the build must not need it.
 */
export function getDb(): Db {
  if (cached) return cached;

  // DATABASE_URL only — deliberately NOT falling back to
  // MIGRATION_DATABASE_URL. That variable points at production, and a silent
  // fallback would mean running the app against live data whenever the app's
  // own variable was missing, which is exactly when you least expect it.
  const url = process.env.DATABASE_URL;

  /**
   * A localhost database in a deployed environment is always a mistake.
   *
   * `.env.local` deliberately points DATABASE_URL at a local Postgres, so that
   * building screens never writes to the client data the v1 app is still
   * serving. Copying that file wholesale into a hosting dashboard is the
   * obvious next step and the wrong one — and the symptom is terrible: every
   * route returns a generic 500, and the SSO callback bounces to "sign-in is
   * temporarily unavailable", neither of which mentions the database.
   *
   * Refusing here turns a confusing outage into one sentence naming the cause.
   */
  // NOT during `next build`. A build serves no requests, and failing it would
  // block deploying the /api/health endpoint that diagnoses this exact
  // problem — which is precisely what happened the first time this guard ran.
  // A broken DATABASE_URL should stop a request, loudly, not stop the deploy
  // of the thing that explains why.
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";

  if (
    url &&
    !isBuild &&
    process.env.NODE_ENV === "production" &&
    /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
  ) {
    throw new Error(
      "DATABASE_URL points at localhost, but this is a production build.\n" +
        "  A deployed app cannot reach your machine. This is almost always\n" +
        "  .env.local copied verbatim into the hosting environment.\n" +
        "  Use the Supabase TRANSACTION pooler (port 6543) instead.",
    );
  }

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set.\n" +
        "  The app uses the TRANSACTION pooler (port 6543).\n" +
        "  MIGRATION_DATABASE_URL is a separate variable for the migration\n" +
        "  scripts (session pooler, 5432) and is never used as a fallback.",
    );
  }

  cached = createDb(url);
  return cached;
}

export { schema };
