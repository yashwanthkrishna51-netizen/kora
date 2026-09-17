import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client, for Storage only.
 *
 * Everything relational goes through Drizzle on the pooler — this exists
 * because Storage has no SQL interface. Shared by attachment signing
 * (lib/storage.ts) and the nightly backup (lib/backup/store.ts) so the two
 * cannot disagree about credentials or session options.
 *
 * Lazily constructed: importing this file must not require the environment to
 * be present, or the build and every test would need real credentials.
 */

let cached: SupabaseClient | undefined;

export function supabase(): SupabaseClient {
  if (!cached) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for storage access",
      );
    }
    // No session persistence or refresh: this is a service-role key on a
    // server, not a user session, and a background refresh timer in a
    // serverless function is just a leak.
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** Test seam — lets a suite swap credentials between cases. */
export function resetSupabaseClient(): void {
  cached = undefined;
}
