"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ApiError } from "@/lib/api/fetcher";
import { conflictRow, isConflict } from "@/lib/query/mutations";
import { fmtDateTime } from "@/lib/utils/dates";

/**
 * "Someone else saved this record first."
 *
 * Kora is a shared tracker; two people editing one client is ordinary. v1's
 * answer was a red toast that auto-dismissed after 3.5 seconds — no diff, no
 * retry, no merge — and then the screen simply re-rendered showing the other
 * person's data, with whatever you had typed gone. This is the designed
 * replacement (handoff §251).
 *
 * IT SHOWS "WHEN", NOT "WHO". The handoff asks for both. `when` is available —
 * it is the OCC token, which is the row's `updated_at`. `who` is not: no entity
 * table carries an `updated_by` column, and `audit_log` records the entity as a
 * TABLE NAME with no record id, so a conflict cannot be attributed to a row.
 * Saying "someone" is the honest version; inventing a name would be worse than
 * omitting it. Adding `audit_log.entity_id` would make it answerable and is
 * noted in the plan.
 */
export function ConflictCard({
  error,
  onReload,
  /** The draft that lost, for the "show what changed" diff. */
  draft,
}: {
  error: unknown;
  onReload: () => void;
  draft?: Record<string, unknown>;
}) {
  const [showDiff, setShowDiff] = useState(false);

  if (!isConflict(error)) return null;

  const current = conflictRow(error);
  const message =
    error instanceof ApiError
      ? error.message
      : "Someone else changed this while you were editing it.";

  // A 409 without `current` is a constraint violation, not a version race —
  // "A client with that name already exists." There is nothing to diff and
  // nothing to reload; the message is the whole answer.
  const healable = current !== null;

  return (
    <div className="k-conflict" role="alert">
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          size={15}
          strokeWidth={1.5}
          aria-hidden
          className="mt-px shrink-0 text-k-text-amber"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-k-text-amber">
            {healable
              ? "Someone else saved this record first"
              : "That change could not be saved"}
          </p>

          <p className="mt-1 text-[12px] text-k-ink-3">
            {healable ? (
              <>
                Your edit was not applied.
                {typeof current._v === "string" && (
                  <> Their version was saved {fmtDateTime(current._v)}.</>
                )}{" "}
                Reload to pick up their changes, then make yours again.
              </>
            ) : (
              message
            )}
          </p>

          {healable && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onReload}
                className="k-btn k-btn-primary k-btn-sm"
              >
                Reload record
              </button>
              {draft && (
                <button
                  type="button"
                  onClick={() => setShowDiff((v) => !v)}
                  aria-expanded={showDiff}
                  className="k-btn k-btn-outline k-btn-sm"
                >
                  {showDiff ? "Hide changes" : "Show what changed"}
                </button>
              )}
            </div>
          )}

          {showDiff && draft && current && (
            <ChangeList draft={draft} current={current} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What you typed, against what is now stored.
 *
 * Only the fields the draft actually touched — a whole-row diff of a client
 * with forty phases is not a thing anyone reads. The point is to let someone
 * re-apply their edit by hand without having to remember it.
 */
function ChangeList({
  draft,
  current,
}: {
  draft: Record<string, unknown>;
  current: Record<string, unknown>;
}) {
  const rows = Object.keys(draft)
    .filter((k) => String(draft[k] ?? "") !== String(current[k] ?? ""))
    .map((k) => ({ field: k, yours: draft[k], theirs: current[k] }));

  if (!rows.length) {
    return (
      <p className="mt-2.5 text-[11.5px] text-k-mute">
        Your version matches theirs — nothing of yours was lost.
      </p>
    );
  }

  return (
    <dl className="mt-2.5 space-y-2 border-t border-k-line-2 pt-2.5">
      {rows.map(({ field, yours, theirs }) => (
        <div key={field}>
          <dt className="k-eyebrow">{humanise(field)}</dt>
          <dd className="mt-0.5 grid gap-1 text-[11.5px] sm:grid-cols-2">
            <span className="text-k-ink-3">
              <span className="text-k-mute">Yours: </span>
              {display(yours)}
            </span>
            <span className="text-k-ink-3">
              <span className="text-k-mute">Saved: </span>
              {display(theirs)}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** `nextAction` -> `Next action`. */
function humanise(field: string): string {
  const spaced = field.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function display(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}
