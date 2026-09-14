import { sql } from "drizzle-orm";
import { rateLimits } from "@/lib/db/schema";
import { tooManyRequests } from "./errors";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Counters for things that cost money or reputation.
 *
 * THIS FAILS CLOSED, which is the opposite of lib/auth/throttle.ts. The two
 * modules look alike and the difference is easy to get backwards, so: the
 * login throttle is defence-in-depth layered over an access control that still
 * works without it, and blocking a legitimate sign-in because a counter is
 * unavailable is worse than letting an attacker have a few more guesses. This
 * is the only thing standing between one compromised editor account and the
 * company's Exchange mailbox, so an unavailable counter means no send.
 */

/**
 * Windows are ALIGNED to the clock, not anchored to the first hit.
 *
 * Two reasons. A stale window is detected in the same statement that
 * increments — `window_start <> excluded.window_start` resets the count — so
 * the row is self-expiring and there is no cleanup job and no unbounded
 * growth. And two concurrent requests compute the same boundary, which is what
 * makes the upsert deterministic.
 */
export function windowStartFor(now: Date, windowMs: number): string {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs).toISOString();
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export interface LimitSpec {
  key: string;
  limit: number;
  windowMs: number;
  /** What the user is told when this one trips. */
  label: string;
}

/** Limits for user-triggered mail. */
export function clientEmailLimits(userId: string): LimitSpec[] {
  return [
    { key: `email:user:${userId}:h`, limit: 10, windowMs: HOUR_MS,
      label: "You have sent 10 emails in the past hour" },
    { key: `email:user:${userId}:d`, limit: 30, windowMs: DAY_MS,
      label: "You have sent 30 emails today" },
    // Every message leaves through the same mailbox, so the throttling and
    // reputational blast radius is shared. One compromised account must not be
    // able to spend the whole mailbox's standing.
    { key: "email:global:d", limit: 200, windowMs: DAY_MS,
      label: "Kora has reached its daily email limit" },
  ];
}

/**
 * Increments every counter, or refuses.
 *
 * All specs go inside one transaction so a failure part-way cannot leave the
 * hourly counter bumped and the daily one not. Interactive transactions are
 * fine on the transaction-mode pooler — Supavisor pins the connection for the
 * duration; only prepared statements are unavailable, and `prepare: false` is
 * already set in lib/db/client.ts.
 *
 * A tripped limit ROLLS BACK its own increment, because the throw happens
 * inside the transaction. That is a deliberate consequence of the atomicity
 * above, not an oversight: it means the counter settles at exactly the limit
 * rather than climbing while someone retries. The caller is still refused —
 * the count is already at the limit — so nothing gets through; the only thing
 * given up is a number nobody reads. Keeping the increment would require
 * abandoning the transaction, and a send that never happened inflating the
 * hourly counter is the worse trade for the legitimate user.
 */
export async function consume(
  db: AnyDb,
  specs: LimitSpec[],
  now = new Date(),
): Promise<void> {
  await db.transaction(async (t) => {
    const tx = t as unknown as AnyDb;

    for (const spec of specs) {
      const windowStart = windowStartFor(now, spec.windowMs);

      // Check and increment in ONE statement. Read-then-write would let two
      // concurrent sends both read 9 and both write 10.
      const [row] = await tx
        .insert(rateLimits)
        .values({ key: spec.key, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: {
            count: sql`case when ${rateLimits.windowStart} = ${windowStart}::timestamptz
                            then ${rateLimits.count} + 1 else 1 end`,
            windowStart: sql`${windowStart}::timestamptz`,
          },
        })
        .returning({ count: rateLimits.count });

      if ((row?.count ?? 0) > spec.limit) {
        const resetsAt = new Date(
          Date.parse(windowStart) + spec.windowMs,
        ).toISOString();
        throw tooManyRequests(
          `${spec.label}. You can send again after ${resetsAt.slice(11, 16)} UTC.`,
        );
      }
    }
  });
}
