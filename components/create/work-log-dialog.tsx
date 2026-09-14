"use client";

import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Field, fieldProps, validate, useCreateForm, omitEmpty } from "@/components/ui/form";
import { useCreateEntity } from "@/lib/query/mutations";
import { useSession, useAssigneeOptions } from "@/lib/query/permissions";
import { workLogCreate } from "@/lib/validation/entities";
import {
  AMS_TYPES,
  AMS_QUERY_LEVELS,
  AMS_ENTRY_STATUSES,
  AMS_MODES,
} from "@/lib/domain/constants";
import { todayStr } from "@/lib/utils/dates";
import { ApiError } from "@/lib/api/fetcher";

/**
 * Add an AMS work-log entry.
 *
 * The widest form in the app — fourteen writable fields, seven of which the
 * work-log TABLE does not show. `ragStatus` is the one that matters most:
 * it feeds `amsClientRag`, so it drives the RAG pill at the top of the screen
 * while being invisible and previously unsettable anywhere.
 *
 * `dateRaised` is the only required field and defaults to today. v1 passed it
 * straight through with no fallback, and the column is `date not null` — so
 * entries created without one had been silently failing the shadow write for
 * as long as dual-write had been running.
 *
 * `hours` goes out as a NUMBER. It is `z.number()` server-side and comes back
 * as a string from Postgres `numeric`; sending the string a text input gives
 * you is a 400.
 */
export function AddWorkLogDialog({
  clientId,
  clientName,
  open,
  onOpenChange,
}: {
  clientId: string;
  clientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const session = useSession();
  const people = useAssigneeOptions();
  const { values, errors, set, setErrors, reset } = useCreateForm({
    dateRaised: todayStr(),
    description: "",
    // Pre-filled with whoever is adding it, which is right far more often than
    // not and is one less field to fill in.
    raisedBy: session?.name ?? "",
    type: "" as string,
    queryLevel: "" as string,
    entryStatus: "Open",
    ragStatus: "" as string,
    modeOfSupport: "" as string,
    hours: "" as string,
    dueDate: "",
  });

  const create = useCreateEntity<Record<string, unknown>>({
    path: `/api/clients/${encodeURIComponent(clientId)}/work-log`,
    screen: "ams",
  });

  function submit() {
    const cleaned = omitEmpty(values) as Record<string, unknown>;
    // The one field that must change type on the way out.
    if (typeof cleaned.hours === "string") {
      const n = Number(cleaned.hours);
      if (!Number.isFinite(n) || n < 0) {
        setErrors({ hours: "Hours must be a number." });
        return;
      }
      cleaned.hours = n;
    }

    const parsed = validate(workLogCreate, cleaned);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    create.mutate(parsed.data as Record<string, unknown>, {
      onSuccess() {
        toast.success("Work-log entry added.");
        reset();
        onOpenChange(false);
      },
      onError(err) {
        toast.error(err instanceof ApiError ? err.message : "Could not add that.");
      },
    });
  }

  const pick = (
    id: string,
    label: string,
    key: keyof typeof values,
    options: readonly string[],
    emptyLabel = "—",
  ) => (
    <Field label={label} htmlFor={id} error={errors[key as string]}>
      <select
        {...fieldProps(id, errors[key as string])}
        className="k-select"
        value={values[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </Field>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Add work-log entry"
      description={clientName}
      wide
      busy={create.isPending}
      footer={
        <>
          <button
            type="button"
            className="k-btn k-btn-outline k-btn-sm"
            disabled={create.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="k-btn k-btn-primary k-btn-sm"
            disabled={create.isPending}
            onClick={submit}
          >
            {create.isPending ? "Adding…" : "Add entry"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Date raised" htmlFor="w-date" error={errors.dateRaised} required>
            <DateField
              {...fieldProps("w-date", errors.dateRaised)}
              label="Date raised"
              invalid={Boolean(errors.dateRaised)}
              clearable={false}
              value={values.dateRaised}
              onChange={(v) => set("dateRaised", v)}
            />
          </Field>
          <Field label="Due date" htmlFor="w-due" error={errors.dueDate}>
            <DateField
              {...fieldProps("w-due", errors.dueDate)}
              label="Due date"
              invalid={Boolean(errors.dueDate)}
              value={values.dueDate}
              onChange={(v) => set("dueDate", v)}
            />
          </Field>
        </div>

        <Field label="Description" htmlFor="w-desc" error={errors.description}>
          <textarea
            {...fieldProps("w-desc", errors.description)}
            className="k-textarea"
            rows={3}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Raised by" htmlFor="w-by" error={errors.raisedBy}>
            <select
              {...fieldProps("w-by", errors.raisedBy)}
              className="k-select"
              value={values.raisedBy}
              onChange={(e) => set("raisedBy", e.target.value)}
            >
              <option value="">—</option>
              {people.filter(Boolean).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Hours" htmlFor="w-hours" error={errors.hours}>
            <input
              {...fieldProps("w-hours", errors.hours)}
              type="number"
              step="any"
              min={0}
              className="k-input"
              value={values.hours}
              onChange={(e) => set("hours", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          {pick("w-type", "Type", "type", AMS_TYPES)}
          {pick("w-level", "Severity", "queryLevel", AMS_QUERY_LEVELS)}
          {pick("w-status", "Status", "entryStatus", AMS_ENTRY_STATUSES, "Open")}
          {pick("w-mode", "Mode of support", "modeOfSupport", AMS_MODES)}
        </div>

        {/* Not shown on the work-log table, but it drives the RAG pill at the
            top of this screen through `amsClientRag`. */}
        {pick("w-rag", "RAG", "ragStatus", ["Green", "Amber", "Red"])}
      </div>
    </Dialog>
  );
}
