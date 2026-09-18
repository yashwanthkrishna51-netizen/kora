import { appSettings } from "@/lib/db/schema";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Upserts one app setting.
 *
 * Settings are a tiny key/value table read on nearly every screen, so the
 * write is an upsert rather than a check-then-insert: the row may or may not
 * exist depending on whether anyone has ever changed that setting, and two
 * admins saving at once must not produce a duplicate-key error.
 */
export async function putSetting<T>(
  db: AnyDb,
  key: string,
  value: T,
): Promise<T> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
  return value;
}
