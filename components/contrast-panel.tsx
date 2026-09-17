"use client";

import { useCallback, useSyncExternalStore } from "react";
import { contrastRatio, parseColor, compositeOver, fmt } from "@/lib/design/contrast";

/**
 * Live contrast readout for the theme currently rendering.
 *
 * The audit in tests/design proves the tokens are sound; this puts the same
 * numbers on screen so a design review looks at measurements rather than
 * impressions — which matters most for dark mode, the half the handoff never
 * specified.
 *
 * The values live in the CSSOM, not in React, so they are read through
 * useSyncExternalStore rather than mirrored into state by an effect. The
 * snapshot is a single string of all the resolved colours: cheap to produce,
 * compares by value, and changes exactly when the theme does.
 */

type Row = { what: string; fg: string; bg: string; need: number };

const ROWS: Row[] = [
  { what: "Body text", fg: "--k-ink", bg: "--k-paper", need: 4.5 },
  { what: "Secondary text", fg: "--k-mute", bg: "--k-paper", need: 4.5 },
  { what: "10px eyebrow", fg: "--k-mute-2", bg: "--k-paper", need: 4.5 },
  { what: "Page title / links", fg: "--k-primary", bg: "--k-paper", need: 4.5 },
  { what: "At Risk text", fg: "--k-text-red", bg: "--k-paper", need: 4.5 },
  { what: "Delayed text", fg: "--k-text-amber", bg: "--k-paper", need: 4.5 },
  { what: "Completed text", fg: "--k-text-green", bg: "--k-paper", need: 4.5 },
  { what: "In Progress text", fg: "--k-text-cyan", bg: "--k-paper", need: 4.5 },
  { what: "Form control border", fg: "--k-field", bg: "--k-paper", need: 3 },
  // need: 0 means decorative — measured and shown, not required to pass.
  { what: "Card hairline", fg: "--k-line", bg: "--k-paper", need: 0 },
];

const TOKENS = Array.from(new Set(ROWS.flatMap((r) => [r.fg, r.bg])));

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/** All resolved token values as one string — stable unless the theme changes. */
function snapshot(): string {
  const cs = getComputedStyle(document.documentElement);
  return TOKENS.map((t) => cs.getPropertyValue(t).trim()).join("|");
}

const serverSnapshot = () => "";

export function ContrastPanel() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  const resolve = useCallback(
    (token: string) => {
      const i = TOKENS.indexOf(token);
      return i === -1 ? "" : (raw.split("|")[i] ?? "");
    },
    [raw],
  );

  // Empty during SSR and the first hydration pass; the observer fills it in.
  if (!raw) {
    return (
      <div className="k-card p-6 text-k-small text-k-mute">
        Measuring…
      </div>
    );
  }

  return (
    <div className="k-card overflow-hidden">
      <div className="k-thead grid grid-cols-[1fr_120px_90px_70px]">
        <span>Pair</span>
        <span>Colour</span>
        <span>Contrast</span>
        <span>WCAG AA</span>
      </div>
      {ROWS.map((r) => {
        const fgHex = resolve(r.fg);
        const bgHex = resolve(r.bg);
        const f = parseColor(fgHex);
        const b = parseColor(bgHex);
        if (!f || !b) return null;

        const ratio = contrastRatio(compositeOver(f, b), b);
        const enforced = r.need > 0;
        const ok = ratio >= r.need;

        return (
          <div
            key={r.what}
            className="k-row grid grid-cols-[1fr_120px_90px_70px] items-center"
          >
            <span className="text-k-ink">{r.what}</span>
            <span className="k-mono flex items-center gap-2 text-[10px] text-k-mute">
              <span
                className="inline-block h-3 w-3 rounded-[2px] border border-k-line"
                style={{ background: fgHex }}
              />
              {fgHex.toUpperCase()}
            </span>
            <span className="k-mono text-[11px] text-k-ink">{fmt(ratio)}</span>
            <span
              className="text-k-label font-semibold"
              style={{
                color: !enforced
                  ? "var(--k-mute-2)"
                  : ok
                    ? "var(--k-text-green)"
                    : "var(--k-text-amber)",
              }}
            >
              {!enforced ? "n/a" : ok ? "pass" : `${r.need}:1`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
