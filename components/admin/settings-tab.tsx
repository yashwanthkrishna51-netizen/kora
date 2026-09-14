"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCapacityWeights } from "@/lib/query/hooks";
import { isReadOnlyBuild } from "@/lib/query/permissions";
import {
  useDigestRecipients,
  useSaveDigestRecipients,
  useSaveCapacityWeights,
} from "@/lib/query/admin";
import { Field, fieldProps, validate } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import {
  capacityWeightsUpdate,
  digestRecipientsUpdate,
} from "@/lib/validation/entities";
import { ApiError } from "@/lib/api/fetcher";

export function SettingsTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DigestRecipientsCard />
      <CapacityWeightsCard />
    </div>
  );
}

/**
 * Who gets the daily digest.
 *
 * One address per line rather than a comma string: addresses are not allowed to
 * contain commas but people paste lists that do, and a textarea makes the
 * boundary between entries unambiguous.
 *
 * The server dedupes case-insensitively, so the saved list can come back
 * SHORTER than the one submitted. The textarea is reset from the response for
 * that reason — echoing the input back would show entries that were not stored.
 */
function DigestRecipientsCard() {
  const readOnly = isReadOnlyBuild();
  const query = useDigestRecipients();
  const save = useSaveDigestRecipients();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  // Seeded once from the query, then owned locally so typing is not overwritten
  // by a refetch mid-edit. Re-seeded from the SAVE RESPONSE in onSuccess below,
  // not from an effect watching it — a setState in an effect body cascades a
  // render, and React 19 lints it for that reason.
  const value = text ?? (query.data ?? []).join("\n");

  function submit() {
    const emails = value
      .split(/[\n,;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const parsed = validate(digestRecipientsUpdate, { emails });
    if (!parsed.ok) {
      setError(parsed.errors.emails ?? "Check these addresses.");
      return;
    }
    setError(undefined);
    save.mutate(emails, {
      onSuccess(stored) {
        // The stored list is authoritative: the server dedupes
        // case-insensitively, so this can be shorter than what was typed.
        setText(stored.join("\n"));
        const dropped = emails.length - stored.length;
        toast.success(
          dropped > 0
            ? `Saved ${stored.length} recipients (${dropped} duplicate${dropped === 1 ? "" : "s"} removed).`
            : `Saved ${stored.length} recipient${stored.length === 1 ? "" : "s"}.`,
        );
      },
      onError: (err) =>
        toast.error(
          err instanceof ApiError ? err.message : "Could not save that list.",
        ),
    });
  }

  return (
    <div className="k-card p-[18px]">
      <h2 className="k-card-title">Daily digest recipients</h2>
      <p className="mt-1 mb-3.5 text-[12px] leading-[1.6] text-k-mute">
        The fallback list. Work is routed to its assignee first; anything with no
        matching person goes here. Maximum 50 addresses.
      </p>

      {/* A FAILED LOAD MUST NOT LOOK LIKE AN EMPTY LIST. Without this the card
          rendered a blank textarea and the Save button stayed live, so a
          transport failure read as "your recipients were wiped" — and pressing
          Save would then have written that empty list back. */}
      {query.error && !query.isPending && (
        <div className="mb-3">
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </div>
      )}

      <Field label="Addresses" htmlFor="s-digest" error={error} hint="One per line.">
        <textarea
          {...fieldProps("s-digest", error)}
          className="k-textarea k-mono text-[11.5px]"
          rows={7}
          value={value}
          disabled={readOnly || query.isPending || Boolean(query.error)}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
        />
      </Field>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="k-btn k-btn-primary k-btn-sm"
          disabled={
            readOnly || save.isPending || query.isPending || Boolean(query.error)
          }
          onClick={submit}
        >
          {save.isPending ? "Saving…" : "Save recipients"}
        </button>
        <span className="text-[11.5px] text-k-mute-2">
          {value.split(/[\n,;]/).filter((s) => s.trim()).length} listed
        </span>
      </div>
    </div>
  );
}

const WEIGHT_FIELDS = [
  { key: "module", label: "Per module", hint: "Weight of one implementation module." },
  { key: "pmo", label: "Per PMO client", hint: "Weight of being master assignee." },
  { key: "ams", label: "Per AMS hour", hint: "Weight of one logged support hour." },
  { key: "cap", label: "Capacity cap", hint: "The score treated as fully loaded." },
] as const;

/**
 * Capacity weights — the arithmetic behind the dashboard's team-bandwidth tile.
 *
 * These have never been editable in either app: v1 read them from `app_settings`
 * and offered no way to write them, so whatever seeded the row is what everyone
 * has been measured by ever since.
 */
function CapacityWeightsCard() {
  const readOnly = isReadOnlyBuild();
  const stored = useCapacityWeights();
  const save = useSaveCapacityWeights();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const values =
    draft ??
    Object.fromEntries(
      WEIGHT_FIELDS.map((f) => [f.key, String(stored[f.key] ?? "")]),
    );

  function submit() {
    const numbers = Object.fromEntries(
      WEIGHT_FIELDS.map((f) => [f.key, Number(values[f.key])]),
    );
    if (Object.values(numbers).some((n) => !Number.isFinite(n))) {
      setErrors({ module: "All four must be numbers." });
      return;
    }

    const parsed = validate(capacityWeightsUpdate, numbers);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess() {
        toast.success("Capacity weights saved.");
        setDraft(null);
      },
      onError: (err) =>
        toast.error(
          err instanceof ApiError ? err.message : "Could not save those.",
        ),
    });
  }

  return (
    <div className="k-card p-[18px]">
      <h2 className="k-card-title">Capacity weights</h2>
      <p className="mt-1 mb-3.5 text-[12px] leading-[1.6] text-k-mute">
        How the dashboard scores each person&rsquo;s load. A score at or above
        the cap shows as fully loaded.
      </p>

      <div className="grid gap-3.5 sm:grid-cols-2">
        {WEIGHT_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            htmlFor={`s-w-${f.key}`}
            error={errors[f.key]}
            hint={f.hint}
          >
            <input
              {...fieldProps(`s-w-${f.key}`, errors[f.key])}
              type="number"
              step="any"
              min={0}
              disabled={readOnly}
              className="k-input"
              value={values[f.key]}
              onChange={(e) => {
                setDraft({ ...values, [f.key]: e.target.value });
                setErrors((x) => ({ ...x, [f.key]: undefined }));
              }}
            />
          </Field>
        ))}
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <button
          type="button"
          className="k-btn k-btn-primary k-btn-sm"
          disabled={readOnly || save.isPending}
          onClick={submit}
        >
          {save.isPending ? "Saving…" : "Save weights"}
        </button>
        {draft && (
          <button
            type="button"
            className="k-btn k-btn-link k-btn-sm"
            onClick={() => {
              setDraft(null);
              setErrors({});
            }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
