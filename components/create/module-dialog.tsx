"use client";

import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Field, fieldProps, validate, useCreateForm } from "@/components/ui/form";
import { useCreateEntity } from "@/lib/query/mutations";
import { moduleCreate } from "@/lib/validation/entities";
import { PHASES } from "@/lib/domain/constants";
import { ApiError } from "@/lib/api/fetcher";

/**
 * Add a module.
 *
 * One field, but the consequence is not small: the server creates the module
 * AND all nine phases in a single transaction. That is stated in the dialog,
 * because "add module" producing ten rows is surprising otherwise — and because
 * the nine are fixed, so nobody should go looking for a way to choose them.
 */
export function AddModuleDialog({
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
  const { values, errors, set, setErrors, reset } = useCreateForm({ name: "" });

  const create = useCreateEntity<Record<string, unknown>>({
    path: `/api/clients/${encodeURIComponent(clientId)}/modules`,
    screen: "implementation",
  });

  function submit() {
    const parsed = validate(moduleCreate, values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    create.mutate(parsed.data as Record<string, unknown>, {
      onSuccess() {
        toast.success(`Added "${values.name.trim()}" with all ${PHASES.length} phases.`);
        reset();
        onOpenChange(false);
      },
      onError(err) {
        toast.error(err instanceof ApiError ? err.message : "Could not add that.");
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
      title="Add module"
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
            {create.isPending ? "Adding…" : "Add module"}
          </button>
        </>
      }
    >
      <Field
        label="Module name"
        htmlFor="m-name"
        error={errors.name}
        required
        hint={`All ${PHASES.length} phases are created with it, in one transaction — a module with only some of them would render as a broken row and skew this client's completion figure.`}
      >
        <input
          {...fieldProps("m-name", errors.name)}
          className="k-input"
          value={values.name}
          autoFocus
          onChange={(e) => set("name", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </Field>
    </Dialog>
  );
}
