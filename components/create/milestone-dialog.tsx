"use client";

import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Field, fieldProps, validate, useCreateForm, omitEmpty } from "@/components/ui/form";
import { useCreateEntity } from "@/lib/query/mutations";
import { useAssigneeOptions } from "@/lib/query/permissions";
import { milestoneCreate } from "@/lib/validation/entities";
import { MILESTONE_STATUSES } from "@/lib/domain/constants";
import { ApiError } from "@/lib/api/fetcher";

/**
 * Add a milestone — artboard 1d's "+ Add milestone".
 *
 * `POST /api/clients/[clientId]/milestones`, `milestoneCreate` and the
 * `"milestone"` branch of the mutation cache have all existed since the tracker
 * was built; nothing in the browser could reach any of them. Milestones could
 * only arrive through the v1 migration, which is why the achieved/total column
 * on the client table has been frozen since launch.
 *
 * `integrationId` is sent but not offered: a milestone belongs to the
 * integration you opened, and the schema deliberately forbids moving one
 * afterwards (see the note above `milestoneUpdate`).
 */
export function AddMilestoneDialog({
  clientId,
  integrationId,
  integrationName,
  open,
  onOpenChange,
}: {
  clientId: string;
  integrationId: string;
  integrationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const assignees = useAssigneeOptions();
  const { values, errors, set, setErrors, reset } = useCreateForm({
    name: "",
    status: "Pending",
    dueDate: "",
    owner: "",
    notes: "",
  });

  const create = useCreateEntity<Record<string, unknown>>({
    path: `/api/clients/${encodeURIComponent(clientId)}/milestones`,
    screen: "milestones",
  });

  function submit() {
    const parsed = validate(milestoneCreate, {
      ...omitEmpty(values),
      integrationId,
    });
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
      title="Add milestone"
      description={integrationName}
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
            {create.isPending ? "Adding…" : "Add milestone"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Name" htmlFor="ms-name" error={errors.name} required>
          <input
            {...fieldProps("ms-name", errors.name)}
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
          <Field label="Status" htmlFor="ms-status" error={errors.status}>
            <select
              {...fieldProps("ms-status", errors.status)}
              className="k-select"
              value={values.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {MILESTONE_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>

          <Field label="Owner" htmlFor="ms-owner" error={errors.owner}>
            <select
              {...fieldProps("ms-owner", errors.owner)}
              className="k-select"
              value={values.owner}
              onChange={(e) => set("owner", e.target.value)}
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
          htmlFor="ms-due"
          error={errors.dueDate}
          hint="Drives the urgency tint on the milestone row."
        >
          <DateField
            {...fieldProps("ms-due", errors.dueDate)}
            label="Due date"
            invalid={Boolean(errors.dueDate)}
            value={values.dueDate}
            onChange={(v) => set("dueDate", v)}
          />
        </Field>

        <Field label="Notes" htmlFor="ms-notes" error={errors.notes}>
          <textarea
            {...fieldProps("ms-notes", errors.notes)}
            className="k-textarea"
            rows={3}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
