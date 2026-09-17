"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Field, fieldProps } from "@/components/ui/form";
import { useChangePassword } from "@/lib/query/admin";
import { ApiError } from "@/lib/api/fetcher";

/**
 * Change your own password.
 *
 * This is on the admin screen because that is where it fits today, but the
 * route is open to ANY signed-in user — so this component is deliberately
 * self-contained and role-free, ready to move to a My Profile screen without
 * changing anything inside it.
 *
 * Until now no user of the new app could change their own password by any
 * means short of an admin doing it for them.
 *
 * The route re-sets the session cookie on success, so the person making the
 * change stays signed in while every OTHER session of theirs dies. That is the
 * right behaviour and it is worth stating on the form: otherwise "you have been
 * signed out everywhere" reads as though it includes this tab.
 */
export function PasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const change = useChangePassword();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setErrors({});
  }

  function submit() {
    // Checked here and nowhere else: the server has no "confirm" field, because
    // confirming is a typing aid rather than a property of the password.
    if (newPassword !== confirm) {
      setErrors({ confirm: "These do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setErrors({ newPassword: "At least 8 characters." });
      return;
    }

    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess() {
          toast.success("Password changed. Your other sessions were signed out.");
          reset();
          onOpenChange(false);
        },
        onError(err) {
          if (err instanceof ApiError && err.status === 401) {
            setErrors({ currentPassword: "That is not your current password." });
            return;
          }
          toast.error(
            err instanceof ApiError ? err.message : "Could not change it.",
          );
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Change your password"
      description="You will stay signed in here. Every other device is signed out."
      busy={change.isPending}
      footer={
        <>
          <button
            type="button"
            className="k-btn k-btn-outline k-btn-sm"
            disabled={change.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="k-btn k-btn-primary k-btn-sm"
            disabled={change.isPending}
            onClick={submit}
          >
            {change.isPending ? "Changing…" : "Change password"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field
          label="Current password"
          htmlFor="p-current"
          error={errors.currentPassword}
          required
        >
          <input
            {...fieldProps("p-current", errors.currentPassword)}
            type="password"
            autoComplete="current-password"
            className="k-input"
            value={currentPassword}
            autoFocus
            onChange={(e) => {
              setCurrent(e.target.value);
              setErrors((x) => ({ ...x, currentPassword: undefined }));
            }}
          />
        </Field>

        <Field
          label="New password"
          htmlFor="p-new"
          error={errors.newPassword}
          required
          hint="At least 8 characters."
        >
          <input
            {...fieldProps("p-new", errors.newPassword)}
            type="password"
            autoComplete="new-password"
            className="k-input"
            value={newPassword}
            onChange={(e) => {
              setNext(e.target.value);
              setErrors((x) => ({ ...x, newPassword: undefined }));
            }}
          />
        </Field>

        <Field
          label="Confirm new password"
          htmlFor="p-confirm"
          error={errors.confirm}
          required
        >
          <input
            {...fieldProps("p-confirm", errors.confirm)}
            type="password"
            autoComplete="new-password"
            className="k-input"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setErrors((x) => ({ ...x, confirm: undefined }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}
