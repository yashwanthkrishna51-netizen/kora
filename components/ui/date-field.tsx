"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * A date field: a typed text input plus a calendar popover.
 *
 * WHY NOT `<input type="date">`, which this replaces: the native control cannot
 * be styled. Its picker glyph is a browser-drawn dark square that vanishes on
 * the navy dark-mode field, its height and border ignore `.k-input`, and its
 * placeholder reads `dd/mm/yyyy` in one locale and `mm/dd/yyyy` in another
 * while the value underneath is neither.
 *
 * THE WIRE FORMAT IS THE WHOLE CONTRACT. Every date in this app is a plain
 * `YYYY-MM-DD` string — `lib/validation/entities.ts` rejects anything else with
 * a regex, and the columns are `date`, not `timestamp`. `type="date"` used to
 * be what guaranteed that, so this control has to guarantee it just as firmly:
 * it emits `YYYY-MM-DD` or the empty string, never a `Date`, never an ISO
 * timestamp.
 *
 * NO `toISOString()` ANYWHERE. That formats in UTC, so west of Greenwich it
 * reports the previous day — the same class of bug the app already documents in
 * `lib/utils/dates.ts`. Parsing and formatting are done on local components.
 *
 * The text input stays. A calendar is a poor way to enter a date you already
 * know, and a keyboard-only user should never be forced through a grid.
 */
export function DateField({
  value,
  onChange,
  id,
  label,
  disabled,
  clearable = true,
  invalid,
  className = "k-input",
  onCommit,
}: {
  /** `YYYY-MM-DD`, or `""` for empty. */
  value: string;
  /** Always called with `YYYY-MM-DD` or `""`. */
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  disabled?: boolean;
  clearable?: boolean;
  invalid?: boolean;
  className?: string;
  /** Fired when the value is settled — a day was picked, or the field blurred. */
  onCommit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The typed text is owned locally while typing so a half-written date is not
  // pushed upstream, then reconciled on blur.
  const text = draft ?? value;

  function commitText(next: string) {
    setDraft(null);
    if (next === "") {
      onChange("");
      onCommit?.();
      return;
    }
    // Only a well-formed, real date is accepted. Anything else reverts rather
    // than silently sending "2026-02-31" to a server that will reject it.
    if (parseISO(next)) {
      onChange(next);
      onCommit?.();
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY-MM-DD"
        aria-label={label}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={`${className} !pr-16`}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          // OPENING THE CALENDAR IS NOT LEAVING THE FIELD. The trigger and the
          // clear button live inside this wrapper, so focus landing on either
          // must not count as a commit — otherwise, inside the inline editor,
          // clicking the calendar icon commits the current value and unmounts
          // the control before it can be used.
          const to = e.relatedTarget as Node | null;
          if (to && wrapRef.current?.contains(to)) return;
          commitText(e.target.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText((e.target as HTMLInputElement).value.trim());
          }
        }}
      />

      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label={`Clear ${label ?? "date"}`}
            onClick={() => {
              setDraft(null);
              onChange("");
              onCommit?.();
            }}
            className="flex h-6 w-6 items-center justify-center rounded-[3px] text-k-mute hover:bg-k-line-2 hover:text-k-ink"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        )}

        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Open calendar${label ? ` for ${label}` : ""}`}
              className="flex h-6 w-6 items-center justify-center rounded-[3px] text-k-mute hover:bg-k-line-2 hover:text-k-primary disabled:opacity-50"
            >
              <Calendar size={13} strokeWidth={1.5} />
            </button>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              className="z-50 rounded-k border border-k-line bg-k-paper p-3 shadow-[var(--k-shadow-l)]"
              // Radix would otherwise pull focus back to the trigger and fight
              // the grid's own roving focus.
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <MonthGrid
                selected={value}
                onPick={(iso) => {
                  setDraft(null);
                  onChange(iso);
                  onCommit?.();
                  setOpen(false);
                  inputRef.current?.focus();
                }}
                onClose={() => {
                  setOpen(false);
                  inputRef.current?.focus();
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- grid */

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function MonthGrid({
  selected,
  onPick,
  onClose,
}: {
  selected: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const selectedDate = parseISO(selected);
  const [cursor, setCursor] = useState<Date>(selectedDate ?? today);
  const gridRef = useRef<HTMLDivElement>(null);

  // Roving focus: whichever day the cursor is on owns the tab stop, and the
  // grid takes focus when it mounts so the keyboard works immediately.
  useEffect(() => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>('button[data-focused="true"]')
      ?.focus();
  }, [cursor]);

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const leading = monthStart.getDay();
  const days = daysInMonth(cursor.getFullYear(), cursor.getMonth());

  const cells: (Date | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from(
      { length: days },
      (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1),
    ),
  ];

  function move(deltaDays: number) {
    const next = new Date(cursor);
    next.setDate(next.getDate() + deltaDays);
    setCursor(next);
  }

  function moveMonth(delta: number) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    // Keep the day of month where it exists, clamp where it does not (31 Jan
    // stepping to February).
    next.setDate(Math.min(cursor.getDate(), daysInMonth(next.getFullYear(), next.getMonth())));
    setCursor(next);
  }

  return (
    <div
      ref={gridRef}
      onKeyDown={(e) => {
        const keys: Record<string, () => void> = {
          ArrowLeft: () => move(-1),
          ArrowRight: () => move(1),
          ArrowUp: () => move(-7),
          ArrowDown: () => move(7),
          PageUp: () => moveMonth(-1),
          PageDown: () => moveMonth(1),
          Home: () => move(-cursor.getDay()),
          End: () => move(6 - cursor.getDay()),
          Escape: onClose,
        };
        const fn = keys[e.key];
        if (fn) {
          e.preventDefault();
          fn();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => moveMonth(-1)}
          className="flex h-6 w-6 items-center justify-center rounded-[3px] text-k-mute hover:bg-k-line-2 hover:text-k-ink"
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </button>
        <span aria-live="polite" className="text-[12.5px] font-semibold text-k-ink">
          {cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => moveMonth(1)}
          className="flex h-6 w-6 items-center justify-center rounded-[3px] text-k-mute hover:bg-k-line-2 hover:text-k-ink"
        >
          <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5" role="grid">
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            role="columnheader"
            className="k-eyebrow flex h-6 items-center justify-center !text-[9px]"
          >
            {d}
          </div>
        ))}

        {cells.map((d, i) => {
          if (!d) return <div key={`pad-${i}`} />;
          const iso = toISO(d);
          const isSelected = iso === selected;
          const isToday = sameDay(d, today);
          const isFocused = sameDay(d, cursor);

          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-current={isToday ? "date" : undefined}
              data-focused={isFocused ? "true" : undefined}
              tabIndex={isFocused ? 0 : -1}
              onClick={() => onPick(iso)}
              className={`k-mono flex h-7 w-7 items-center justify-center rounded-[3px] text-[11px] transition-colors ${
                isSelected
                  ? "bg-k-primary font-bold text-white"
                  : isToday
                    ? "font-bold text-k-primary hover:bg-k-primary/[.08]"
                    : "text-k-ink-3 hover:bg-k-primary/[.08]"
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-k-line-2 pt-2">
        <button
          type="button"
          onClick={() => onPick(toISO(today))}
          className="k-btn k-btn-link !text-[11.5px]"
        >
          Today
        </button>
        <span className="k-mono text-[10px] text-k-mute-2">esc to close</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ dates */

/**
 * `YYYY-MM-DD` → a local Date, or null.
 *
 * Built from local components rather than `new Date(str)`, which parses a
 * date-only string as UTC midnight and therefore lands on the previous day for
 * anyone west of Greenwich. The round-trip check rejects the dates JS silently
 * rolls over — `2026-02-31` would otherwise become 3 March.
 */
export function parseISO(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** A local Date → `YYYY-MM-DD`. Never `toISOString`; see the note above. */
export function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
