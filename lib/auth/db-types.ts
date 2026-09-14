import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";

/**
 * A Drizzle handle over our schema, whichever driver is behind it.
 *
 * The application runs postgres-js against Supabase; the tests run PGlite
 * in-process. Auth functions take this type rather than importing the app's
 * singleton, so the same code is exercised in both places — the alternative is
 * testing auth against mocks and only ever running the real thing in
 * production, which is precisely where you least want the first real run.
 */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;
