import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Identifiers.
 *
 * Two rules, both carried over from the security work on the old app and both
 * load-bearing:
 *
 * 1. IDS ARE MINTED ON THE SERVER. The old client generated them with
 *    `Date.now().toString(36) + Math.random().toString(36).slice(2, 6)` — four
 *    random base36 characters, about 1.7 million combinations, keyed to the
 *    millisecond. Two people clicking "add" in the same millisecond had a real
 *    chance of colliding, and in v1 that was invisible because ids only had to
 *    be unique within one client's array. In v2 they are primary keys, so a
 *    collision is a hard failure or, worse, an upsert onto someone else's row.
 *    Preflight had to gate on exactly this.
 *
 * 2. EVERY ID IS A PLAIN SLUG. `^[A-Za-z0-9_-]{1,64}$`, checked before an id
 *    reaches a query or gets rendered back out. This is what closes the stored
 *    XSS chain (an id echoed into markup) and the filter-injection bug in the
 *    old PostgREST calls. Drizzle parameterises everything, so injection is no
 *    longer reachable that way, but the rule stays: ids also travel into URLs,
 *    DOM attributes and export filenames, and a slug is safe in all of them.
 */

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const idSchema = z
  .string()
  .regex(ID_RE, "Invalid identifier")
  .max(64);

/** Prefixes make an id self-describing in logs, URLs and audit rows. */
export type IdPrefix = "c" | "in" | "ms" | "md" | "ph" | "wl" | "u" | "t";

/**
 * A new identifier: prefix + 18 bytes of CSPRNG entropy in base36.
 *
 * Not time-prefixed. Sortability was never used, and embedding a timestamp
 * leaks creation time into every URL and export filename for no benefit.
 */
export function newId(prefix: IdPrefix): string {
  const raw = BigInt("0x" + randomBytes(18).toString("hex")).toString(36);
  return `${prefix}_${raw.slice(0, 22)}`;
}

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/**
 * The separator inside a derived id.
 *
 * A NUL, because it cannot occur in any of the values being joined, so
 * ("ab", "c") and ("a", "bc") can never hash to the same id. It was written
 * as a raw 0x00 byte in the source, which made the file binary to grep and
 * diff and left the separator invisible to anyone editing that line — an
 * accidental deletion would silently re-mint every phase id in the database.
 * The escape is the identical byte at runtime and keeps the file readable.
 */
const SEP = "\0";

function shortHash(...parts: string[]): string {
  return createHash("sha256").update(parts.join(SEP)).digest("hex").slice(0, 24);
}

/**
 * Stable phase id, derived from (moduleId, phaseName).
 *
 * The nine phases of a module are a fixed set rather than user-created rows,
 * so a deterministic id keeps a backfill re-run idempotent and keeps phase
 * URLs stable across it. This is the derivation that minted all 702 phase ids
 * in production; tests/migrate/mapping.test.ts pins it against real stored
 * values so the inputs, order and separator cannot change silently.
 */
export function derivePhaseId(moduleId: string, phaseName: string): string {
  return `ph_${shortHash(moduleId, phaseName)}`;
}
