"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useUpdateEntity, buildPatch, isConflict, type EntityKind } from "@/lib/query/mutations";
import { ApiError } from "@/lib/api/fetcher";
import { DateField } from "@/components/ui/date-field";

/**
 * Inline editing.
 *
 * SCOPED TO WHAT WAS ACTUALLY INLINE IN v1, which is narrower than it sounds:
 * four `<select>`s that saved on change (integration status, assignee and
 * effort weight, and the Implementation client's master assignee). Everything
 * else was an explicit Save button or a modal. Widening that is a design
 * decision, not a port, so it is not made here.
 *
 * Two defects in v1's version are fixed rather than reproduced:
 *
 * IT NEVER RE-RENDERED ON SUCCESS. `statusEl.disabled = false` and nothing
 * else, so RAG badges, progress rings and counts stayed stale until something
 * unrelated redrew the page. The cache update fixes that for free.
 *
 * IT HAD NO UNSAVED-CHANGES GUARD ANYWHERE. Typing into a field and navigating
 * away discarded it silently — which is why v1's background refresh was
 * forbidden from re-rendering at all. `InlineText` commits on blur, so there is
 * nothing left dangling.
 */

interface Target {
  kind: EntityKind;
  clientId: string;
  id: string;
  /** API path for this entity's PATCH. */
  path: string;
  /** Recorded on the audit row. */
  screen?: string;
}

/** Turns a failed write into something the person can act on. */
function useSaveFeedback() {
  return (error: unknown) => {
    if (isConflict(error)) {
      toast.error("Someone else saved this first — reloading their version.");
      return;
    }
    toast.error(
      error instanceof ApiError ? error.message : "Could not save. Try again.",
    );
  };
}

/**
 * A select that saves the moment it changes.
 *
 * Disabled while in flight rather than showing a spinner: the control is 32px
 * and a spinner inside it reads as a glitch. The optimistic update means the
 * new value is already showing, so there is nothing to wait for visually.
 */
export function InlineSelect<T extends object>({
  target,
  field,
  value,
  options,
  version,
  before,
  label,
  disabled,
  emptyLabel = "—",
  unknownSuffix = "(unrecognised)",
  optionDisabled,
  nullable,
  hint,
  kind = "text",
  optionLabel,
}: {
  target: Target;
  field: keyof T & string;
  value: string;
  options: readonly string[];
  version: string | undefined;
  before: T;
  label: string;
  disabled?: boolean;
  /** What the empty option reads as. A blank row is not self-explanatory. */
  emptyLabel?: string;
  /**
   * Appended to a value that matches no option. Field-specific: "(not a
   * current user)" is right for an assignee and nonsense on a status.
   */
  unknownSuffix?: string;
  /**
   * Disables individual options. The signoff gate needs this: BPU/CRP/UAT
   * Signoff cannot be Completed without a document attached, but every other
   * status stays available.
   *
   * Filtering the options array instead would collide with the unknown-value
   * logic below — a phase already Completed would have its own status
   * re-inserted and labelled as unrecognised.
   */
  optionDisabled?: (option: string) => boolean;
  /**
   * Send `null` rather than `""` when the empty option is chosen.
   *
   * Required for every nullish ENUM — `type`, `queryLevel`, `modeOfSupport`,
   * `ragStatus`. `z.enum([...]).nullish()` accepts null and rejects `""`, so
   * without this "clear it" is a 400. Free-text columns like `assignee` are
   * `text().nullish()` and accept `""`, but writing null there too keeps one
   * representation of empty in the column instead of two.
   */
  nullable?: boolean;
  /** Explains a disabled option, next to the control. */
  hint?: React.ReactNode;
  /**
   * SEND A NUMBER, for a column that is one.
   *
   * `buildPatch` does not coerce — `NUMERIC_FIELDS` there only skips a write
   * when two numbers are already equal — so a select over `effortWeight` would
   * post the string "0.5" into `z.number().positive()` and take a 400. The
   * text editor beside this has had the same switch since it was written; this
   * is that, for a fixed set of values rather than typed ones.
   */
  kind?: "text" | "number";
  /**
   * What an option READS as, when the stored value is not a sentence.
   *
   * "0.5" is a weight, not a label. The option's value is still the stored one,
   * so an unrecognised value keeps working: it is offered as itself and marked
   * with `unknownSuffix` rather than being snapped to the nearest named step.
   */
  optionLabel?: (value: string) => string;
}) {
  const onFailure = useSaveFeedback();
  const update = useUpdateEntity(target.kind, target.clientId, target.id, {
    path: target.path,
    screen: target.screen,
    onFailure,
  });

  // A <select> whose value is absent from its options silently displays the
  // FIRST option instead — so the row would calmly report the wrong owner. That
  // is not hypothetical here: assignee columns hold typed display names, and
  // production already contains two ("Himanshu", "Nisha") that match no user.
  // The current value is always offered, marked as unrecognised.
  const known = options.includes(value);
  const choices = known ? options : [value, ...options];

  const select = (
    <select
      className="k-select"
      aria-label={label}
      value={value}
      disabled={disabled || update.isPending || !version}
      // No version means the read path did not supply one. Sending the write
      // anyway would 428; disabling says so quietly instead.
      title={version ? undefined : "Reload to edit this"}
      onChange={(e) => {
        const raw = e.target.value;
        const cleared = nullable && raw === "";
        // Empty is only ever null or "", never NaN: `Number("")` is 0, which
        // would silently write a real zero where the user meant "clear it".
        const next = cleared
          ? null
          : kind === "number"
            ? Number(raw)
            : raw;
        if (kind === "number" && !cleared && !Number.isFinite(next as number)) {
          return;
        }
        const patch = buildPatch(before, { [field]: next } as never, [field]);
        if (!Object.keys(patch).length || !version) return;
        update.mutate({ version, patch });
      }}
    >
      {choices.map((o) => (
        <option
          key={o}
          value={o}
          // Never disable the CURRENT value: a select whose selected option is
          // disabled still displays it, but the row would become uneditable in
          // both directions once it got there.
          disabled={o !== value && optionDisabled?.(o)}
        >
          {o === "" ? emptyLabel : (optionLabel?.(o) ?? o)}
          {o === value && !known ? ` ${unknownSuffix}` : ""}
        </option>
      ))}
    </select>
  );

  return hint ? (
    <div className="min-w-0">
      {select}
      <span className="mt-1 block text-[11px] text-k-text-amber">{hint}</span>
    </div>
  ) : (
    select
  );
}

/**
 * A read-mode value that becomes an input when you click it.
 *
 * Commits on blur or Enter, abandons on Escape. No debounced autosave: v1 had
 * none either, and a field that saves while you are still typing turns every
 * intermediate state into an audit row.
 */
export function InlineText<T extends object>({
  target,
  field,
  value,
  version,
  before,
  label,
  placeholder = "—",
  /** Sends `null` rather than `""` when cleared, so the column goes null. */
  nullable,
  /**
   * What the control is. The API's schemas are strict about type, and sending
   * the wrong one is a 400 rather than anything forgiving:
   *
   *   date      `optionalDate` is /^\d{4}-\d{2}-\d{2}$/, so free text 400s.
   *   number    `hours` is z.number(); a string 400s.
   *   textarea  currentActivity/nextAction/solution render whitespace-pre-wrap,
   *             and a single-line input silently flattens their newlines.
   */
  kind = "text",
  /** Display formatter for read mode. Editing always shows the raw value. */
  format,
}: {
  target: Target;
  field: keyof T & string;
  value: string;
  version: string | undefined;
  before: T;
  label: string;
  placeholder?: string;
  nullable?: boolean;
  kind?: "text" | "date" | "number" | "textarea";
  format?: (v: string) => string;
}) {
  // `draft` exists only while editing, and is seeded when edit mode opens.
  //
  // The obvious alternative — `useState(value)` plus an effect re-syncing it
  // whenever `value` changes — trips React 19's set-state-in-effect rule, and
  // deservedly: it makes the field's contents a copy that can drift from its
  // source. Since the resting state renders `value` directly, there is nothing
  // to keep in sync, and a background refetch landing mid-edit cannot yank the
  // text out from under whoever is typing.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // THE ROW AS IT WAS WHEN EDITING BEGAN — value and OCC token together.
  //
  // Keeping the draft un-synced while letting `version` refresh from props was
  // a silent lost update: click into a field, let the 60-second refetch land
  // someone else's change and a NEW token, click away, and the old value went
  // up with THEIR token. The server saw a valid precondition, accepted it, and
  // their edit was reverted with no 409 and no conflict card — which defeats
  // the entire mechanism `_v` exists for. Sending the token you actually read
  // turns that back into the conflict it always was.
  const opened = useRef<{ version: string | undefined; before: T } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Escape must ABANDON. Closing the field can in principle fire `blur` on the
  // way out, which would commit the edit Escape just discarded — a ref, not
  // state, because `commit` has to see it in the same tick.
  //
  // Defensive: the case is not reproducible in jsdom, because closing unmounts
  // the input before a dispatched blur can reach React. Kept anyway, and the
  // test says plainly that it does not cover it rather than implying it does.
  const abandoned = useRef(false);
  const onFailure = useSaveFeedback();

  const update = useUpdateEntity(target.kind, target.clientId, target.id, {
    path: target.path,
    screen: target.screen,
    onFailure,
  });

  useEffect(() => {
    if (!editing) return;
    // `select()` on `type="date"` and `type="number"` throws InvalidStateError
    // in some browsers — those are not text controls. Focus is enough there.
    if (kind === "textarea") textareaRef.current?.select();
    else if (kind === "text") inputRef.current?.select();
    else inputRef.current?.focus();
  }, [editing, kind]);

  const commit = () => {
    setEditing(false);
    if (abandoned.current) {
      abandoned.current = false;
      return;
    }
    const snapshot = opened.current;
    opened.current = null;
    if (!snapshot) return;

    const next = draft.trim();

    // Coerce to what the schema expects. A number field sending a string, or a
    // date field sending free text, is a 400 the user cannot act on.
    let outgoing: unknown;
    if (next === "") {
      // A NUMBER field cannot send `""` — `z.number()` rejects it, and a
      // browser reports a value it refused to accept (letters typed into
      // `type=number`) as an empty string, so this is the path a mistyped
      // entry actually takes. Clearing is only meaningful when the column is
      // nullable; otherwise say so rather than sending a 400.
      if (kind === "number" && !nullable) {
        toast.error(`${label} must be a number.`);
        return;
      }
      outgoing = nullable ? null : "";
    } else if (kind === "number") {
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`${label} must be a number.`);
        return;
      }
      outgoing = n;
    } else {
      outgoing = next;
    }

    const patch = buildPatch(snapshot.before, { [field]: outgoing } as never, [
      field,
    ]);
    if (!Object.keys(patch).length) return;
    if (!snapshot.version) {
      toast.error("Reload before editing this — its version is missing.");
      return;
    }
    update.mutate({ version: snapshot.version, patch });
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={`k-field k-field-edit ${kind === "textarea" ? "!h-auto min-h-[32px] items-start py-1.5" : ""}`}
        onClick={() => {
          opened.current = { version, before };
          setDraft(value);
          setEditing(true);
        }}
        aria-label={`${label}: ${value || "empty"}. Click to edit`}
      >
        <span
          className={`${value ? "text-k-ink" : "text-k-mute"} ${
            kind === "textarea" ? "line-clamp-2 whitespace-pre-wrap text-left" : ""
          }`}
        >
          {value ? (format ? format(value) : value) : placeholder}
        </span>
      </button>
    );
  }

  const onKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    // Enter COMMITS everywhere except a textarea, where it has to insert a
    // newline — those fields exist to hold multi-line notes, and stealing
    // Enter would make that impossible. Cmd/Ctrl+Enter saves there instead.
    if (e.key === "Enter" && (kind !== "textarea" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      abandoned.current = true;
      setEditing(false);
    }
  };

  if (kind === "textarea") {
    return (
      <textarea
        ref={textareaRef}
        className="k-textarea"
        rows={4}
        aria-label={label}
        value={draft}
        disabled={update.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        autoFocus
      />
    );
  }

  if (kind === "date") {
    // The native picker used to be what guaranteed YYYY-MM-DD; DateField makes
    // the same guarantee and can actually be styled. It commits when a day is
    // picked or the typed text settles, rather than on every blur — opening its
    // own calendar blurs the input, and committing there would close the editor
    // before the calendar could be used.
    return (
      <DateField
        value={draft}
        onChange={setDraft}
        onCommit={commit}
        label={label}
        disabled={update.isPending}
        className="k-input k-input-sm"
      />
    );
  }

  return (
    <input
      ref={inputRef}
      type={kind === "number" ? "number" : "text"}
      step={kind === "number" ? "any" : undefined}
      min={kind === "number" ? 0 : undefined}
      className="k-input k-input-sm"
      aria-label={label}
      value={draft}
      disabled={update.isPending}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      autoFocus
    />
  );
}
