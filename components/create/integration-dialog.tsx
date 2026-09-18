"use client";

import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Field, fieldProps, validate, useCreateForm, omitEmpty } from "@/components/ui/form";
import { useCreateEntity } from "@/lib/query/mutations";
import { useAssigneeOptions } from "@/lib/query/permissions";
import { integrationCreate } from "@/lib/validation/entities";
import { STATUSES } from "@/lib/domain/constants";
import { ApiError } from "@/lib/api/fetcher";

/**
 * Add an integration.
 *
 * The first create flow in the app. Until now `useCreateEntity` had zero
 * callers and every POST route was unreachable from a browser — the trackers
 * could be read and edited but never added to, which is not a replacement for
 * a system twenty people add to.
 *
 * Only `name` is required, matching `integrationCreate`. The rest are offered
 * because filling them in at creation is cheaper than hunting the row down
 * afterwards, but none of them block.
 */
export function AddIntegrationDialog({
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
  const assignees = useAssigneeOptions();
  const { values, errors, set, setErrors, reset } = useCreateForm({
    name: "",
    status: "Not Started",
    assignee: "",
    dueDate: "",
    description: "",
  });

  const create = useCreateEntity<Record<string, unknown>>({
    path: `/api/clients/${encodeURIComponent(clientId)}/integrations`,
    screen: "integrations",
  });

  function submit() {
    const parsed = validate(integrationCreate, omitEmpty(values));
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    create.mutate(parsed.data as Record<string, unknown>, {
      onSuccess() {
        toast.success(`Added "${values.name.trim()}".`);
        reset();
        onOpenChange(false);
      },
      onError(err) {
        toast.error(
          err instanceof ApiError ? err.message : "Could not add that.",
        );
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Add integration"
      description={clientName}
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
            {create.isPending ? "Adding…" : "Add integration"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Name" htmlFor="i-name" error={errors.name} required>
          <input
            {...fieldProps("i-name", errors.name)}
            className="k-input"
            value={values.name}
            autoFocus
            onChange={(e) => set("name", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Status" htmlFor="i-status" error={errors.status}>
            <select
              {...fieldProps("i-status", errors.status)}
              className="k-select"
              value={values.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>

          <Field label="Assignee" htmlFor="i-assignee" error={errors.assignee}>
            <select
              {...fieldProps("i-assignee", errors.assignee)}
              className="k-select"
              value={values.assignee}
              onChange={(e) => set("assignee", e.target.value)}
            >
              <option value="">Unassigned</option>
              {assignees.filter(Boolean).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Due date"
          htmlFor="i-due"
          error={errors.dueDate}
          hint="Drives the overdue flag and the RAG on this client."
        >
          <DateField
            {...fieldProps("i-due", errors.dueDate)}
            label="Due date"
            invalid={Boolean(errors.dueDate)}
            value={values.dueDate}
            onChange={(v) => set("dueDate", v)}
          />
        </Field>

        <Field label="Description" htmlFor="i-desc" error={errors.description}>
          <textarea
            {...fieldProps("i-desc", errors.description)}
            className="k-textarea"
            rows={3}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
