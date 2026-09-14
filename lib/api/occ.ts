import type { NextRequest } from "next/server";
import { AppError } from "./errors";

/**
 * Optimistic concurrency at the request boundary.
 *
 * Kora is a shared tracker: two people editing the same client at once is
 * ordinary, not exotic. The old app compared `updated_at` inside a PostgREST
 * filter and, when the filter matched nothing, told the user "Save failed" —
 * which is both wrong and unactionable, because their edit was fine and the
 * only problem was that they were holding a stale copy.
 *
 * The contract here:
 *
 *   GET     returns `_v`, the row's updated_at as a canonical UTC token.
 *   PATCH   must send `If-Match: <_v>`. No header is 428, not 200 — a write
 *   DELETE  that forgot its precondition is a bug, and silently letting it
 *           through would defeat the whole mechanism.
 *   409     carries `current`: the fresh row. The client re-renders from that
 *           rather than dropping the user back to a reload.
 *
 * Only the request half lives here. Turning "the UPDATE matched no rows" into
 * a 404 or a 409 belongs with the statement that did the matching, and lives
 * in lib/db/mutations/core.ts — an earlier version of this file had a second
 * copy of that logic which nothing called.
 */

/** Reads and validates If-Match. Throws 428 when absent. */
export function requireIfMatch(req: NextRequest): string {
  const raw = req.headers.get("if-match");

  if (!raw) {
    throw new AppError(
      428,
      "This change needs a version to check against. Reload and try again.",
      { code: "precondition_required" },
    );
  }

  // `*` means "any version" in RFC 9110. Honouring it here would be an
  // opt-out of concurrency control that any client could take by accident,
  // so it is refused explicitly rather than silently accepted.
  if (raw.trim() === "*") {
    throw new AppError(428, "If-Match: * is not accepted on this resource", {
      code: "precondition_required",
    });
  }

  // Strip optional ETag quoting/weak marker so a client that formats the
  // header properly is not punished for it.
  const token = raw.trim().replace(/^W\//, "").replace(/^"|"$/g, "");

  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(token)) {
    throw new AppError(400, "Malformed version token", {
      code: "bad_precondition",
    });
  }

  return token;
}
