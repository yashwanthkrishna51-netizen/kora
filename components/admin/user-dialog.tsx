"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Field, fieldProps, validate } from "@/components/ui/form";
import { userCreate, userUpdate } from "@/lib/validation/entities";
import { useCreateUser, useUpdateUser, type UserRow } from "@/lib/query/admin";
import type { UserAdminView } from "@/lib/db/queries/users";
import { ApiError } from "@/lib/api/fetcher";

const ROLES = [
  { value: "viewer", hint: "Read everything. Cannot change anything." },
  { value: "editor", hint: "Read and edit the trackers." },
  { value: "admin", hint: "Everything, including this screen." },
] as const;

/**
 * Create or edit a user.
 *
 * One dialog for both, because the fields are the same set minus one — and the
 * one that differs is the interesting part:
 *
 * **Username is immutable.** `userUpdate` omits it deliberately: it is the
 * login identifier AND the key `audit_log` stores verbatim on every row already
 * written. Renaming it would silently detach a person from their own history,
 * and would break `lastActive`, which joins on it. So on edit it is shown
 * disabled rather than hidden — "you cannot change this" is information; a
 * missing field is a puzzle.
 *
 * **Password is required on create, optional on edit.** On edit it is an admin
 * reset, which bumps `token_version` and signs that person out everywhere.
 * Worth saying out loud on the form, because it is not reversible and the
 * person on the other end just gets logged out with no explanation.
 */
export function UserDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent = create. */
  editing?: UserAdminView;
}) {
  const isEdit = Boolean(editing);
  const create = useCreateUser();
  const update = useUpdateUser();
  const busy = create.isPending || update.isPending;

  const [values, setValues] = useState(() => ({
    username: editing?.username ?? "",
    name: editing?.name ?? "",
    email: editing?.email ?? "",
    role: editing?.role ?? "viewer",
    password: "",
  }));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const set = (key: keyof typeof values, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  function submit() {
    if (isEdit && editing) {
      // Only what actually changed. `userUpdate` is .strict() and an empty
      // patch is a 400 "Nothing to update", not a no-op, so an unchanged form
      // must not be sent at all.
      const patch: Record<string, unknown> = {};
      if (values.name !== editing.name) patch.name = values.name;
      if (values.email !== editing.email) patch.email = values.email;
      if (values.role !== editing.role) patch.role = values.role;
      if (values.password) patch.password = values.password;

      if (Object.keys(patch).length === 0) {
        onOpenChange(false);
        return;
      }

      const parsed = validate(userUpdate, patch);
      if (!parsed.ok) {
        setErrors(parsed.errors);
        return;
      }

      update.mutate(
        { id: editing.id, version: editing._v, patch: parsed.data as Record<string, unknown> },
        {
          onSuccess() {
            toast.success(
              patch.password
                ? `Updated ${editing.username}. They have been signed out everywhere.`
                : `Updated ${editing.username}.`,
            );
            onOpenChange(false);
          },
          onError: reportError,
        },
      );
      return;
    }

    const parsed = validate(userCreate, values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    create.mutate(parsed.data as unknown as Record<string, unknown>, {
      onSuccess(row: UserRow) {
        toast.success(`Added ${row.username}.`);
        onOpenChange(false);
      },
      onError: reportError,
    });
  }

  function reportError(err: unknown) {
    if (err instanceof ApiError) {
      // 409 here is the case-insensitive username clash, and 428/409 on edit is
      // a lost race — both carry a usable message from the server.
      toast.error(err.message);
      if (err.status === 409 && !isEdit) {
        setErrors({ username: "That username is already taken." });
      }
      return;
    }
    toast.error(isEdit ? "Could not save that." : "Could not add that user.");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? `Edit ${editing!.username}` : "Add user"}
      description={
        isEdit ? undefined : "They can sign in as soon as you save this."
      }
      busy={busy}
      footer={
        <>
          <button
            type="button"
            className="k-btn k-btn-outline k-btn-sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="k-btn k-btn-primary k-btn-sm"
            disabled={busy}
            onClick={submit}
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add user"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            label="Username"
            htmlFor="u-username"
            error={errors.username}
            required={!isEdit}
            hint={
              isEdit
                ? "Cannot be changed — it is the key on every audit row."
                : undefined
            }
          >
            <input
              {...fieldProps("u-username", errors.username)}
              className="k-input k-mono"
              value={values.username}
              disabled={isEdit}
              autoFocus={!isEdit}
              onChange={(e) => set("username", e.target.value)}
            />
          </Field>

          <Field label="Name" htmlFor="u-name" error={errors.name} required>
            <input
              {...fieldProps("u-name", errors.name)}
              className="k-input"
              value={values.name}
              autoFocus={isEdit}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Email"
          htmlFor="u-email"
          error={errors.email}
          hint="Used to match Microsoft sign-in and to route the daily digest."
        >
          <input
            {...fieldProps("u-email", errors.email)}
            type="email"
            className="k-input"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>

        <Field label="Role" htmlFor="u-role" error={errors.role} required>
          <select
            {...fieldProps("u-role", errors.role)}
            className="k-select"
            value={values.role}
            onChange={(e) => set("role", e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.value[0].toUpperCase() + r.value.slice(1)} — {r.hint}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={isEdit ? "Reset password" : "Password"}
          htmlFor="u-password"
          error={errors.password}
          required={!isEdit}
          hint={
            isEdit
              ? "Leave blank to keep the current one. Setting it signs them out of every device — and does NOT clear a lockout."
              : "At least 8 characters. Stored hashed; nobody can read it back."
          }
        >
          <input
            {...fieldProps("u-password", errors.password)}
            type="password"
            autoComplete="new-password"
            className="k-input"
            value={values.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
