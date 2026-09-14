/**
 * WCAG 2.1 contrast maths.
 *
 * Dark mode is the part of the Kognoz handoff that does not exist — it
 * specifies four values and leaves the rest to us. Deriving twenty colours by
 * eye is how you end up with a theme that looks fine to the person who made it
 * and is unreadable for everyone else, so every pair the app actually renders
 * is measured instead.
 *
 * Pure functions, no DOM: the audit runs in the test suite.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0–1. Tint tokens are rgba and must be composited before measuring. */
  a: number;
}

/** Accepts `#rgb`, `#rrggbb`, `rgb(...)` and `rgba(...)`. */
export function parseColor(input: string): Rgb | null {
  const s = input.trim();

  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgb = s.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i,
  );
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }

  return null;
}

/**
 * Flattens a translucent colour onto an opaque background.
 * Status pills are tints, so their real contrast depends on what is behind
 * them — measuring the tint alone would be meaningless.
 */
export function compositeOver(fg: Rgb, bg: Rgb): Rgb {
  if (fg.a >= 1) return { ...fg, a: 1 };
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function channelToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(c: Rgb): number {
  return (
    0.2126 * channelToLinear(c.r) +
    0.7152 * channelToLinear(c.g) +
    0.0722 * channelToLinear(c.b)
  );
}

/** WCAG contrast ratio, 1–21. Order of arguments does not matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast of a possibly-translucent foreground against an opaque background. */
export function ratioOn(fg: string, bg: string): number | null {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return null;
  return contrastRatio(compositeOver(f, b), b);
}

/**
 * WCAG AA thresholds.
 *
 * `normal` covers body copy. `large` is 18.66px+ bold or 24px+ regular.
 * `ui` (3:1) is the AA requirement for the boundary of an interactive control
 * or a meaningful graphic — status dots and chart segments fall here, and
 * holding them to the text threshold would be wrong.
 */
export const AA = { normal: 4.5, large: 3.0, ui: 3.0 } as const;

export type Level = keyof typeof AA;

export function passes(ratio: number, level: Level = "normal"): boolean {
  // Round to two decimals first: a 4.499 that displays as "4.50" should not
  // read as a failure to someone checking the number by hand.
  return Math.round(ratio * 100) / 100 >= AA[level];
}

export function fmt(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}
