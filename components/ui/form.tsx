"use client";

import { useState, type ReactNode } from "react";
import type { z } from "zod";

/**
 * Small form primitives, validated against the SERVER'S OWN ZOD SCHEMAS.
 *
 * `lib/validation/entities.ts` is imported directly rather than restated. zod
 * is already a client dependency, so the browser checks exactly what the route
 * checks — one definition, and a field cannot drift out of agreement with the
 * thing that will reject it. A hand-written mirror of those rules is how you
 * get a form that accepts something the server refuses.
 *
 * Local validation is a courtesy, not a boundary. The route re-parses
 * everything; this only saves a round trip and puts the message next to the
 * field instead of in a toast.
 */

export interface FieldError {
  [field: string]: string | undefined;
}

/**
 * Runs a zod schema and returns per-field messages.
 *
 * Zod reports the whole tree; a form needs "which input do I put this under".
 * Only the FIRST error per field is kept — a field with three simultaneous
 * complaints is a field nobody reads.
 */
export function validate<S extends z.ZodType>(
  schema: S,
  value: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; errors: FieldError } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };

  const errors: FieldError = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

/** Label + control + error, wired with aria-describedby. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  return (
    <div>
      <label className="k-label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-k-text-red">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {/* Colour is never the only signal — the message is a real element and
          the control points at it, because a red border says nothing to a
          screen reader. */}
      {error && (
        <span id={errorId} className="k-error" role="alert">
          {error}
        </span>
      )}
      {hint && !error && (
        <span id={hintId} className="mt-1 block text-[11px] text-k-mute">
          {hint}
        </span>
      )}
    </div>
  );
}

/** The props every control in a `Field` needs, so no call site forgets them. */
export function fieldProps(id: string, error?: string) {
  return {
    id,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  };
}

/**
 * Form state for a create dialog.
 *
 * Errors clear on the next edit of that field rather than persisting until the
 * next submit — a message that stays put while you fix it reads as broken.
 */
export function useCreateForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FieldError>({});

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key as string] ? { ...e, [key as string]: undefined } : e));
  };

  const reset = () => {
    setValues(initial);
    setErrors({});
  };

  return { values, errors, set, setErrors, reset };
}

/**
 * Strips empty optional fields before validation.
 *
 * An untouched text input is `""`. Sending that sets the column to an empty
 * string rather than leaving it null — two representations of "not filled in"
 * in the same column, which is the shape of bug that made `assignee` ambiguous
 * on the tracker tables.
 */
export function omitEmpty<T extends Record<string, unknown>>(values: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === "" || v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}
