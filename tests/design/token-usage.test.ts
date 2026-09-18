import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { STATUS_CELL, STATUSES } from "@/lib/domain/constants";

/**
 * Are the design tokens used for what they are FOR?
 *
 * `contrast.test.ts` audits the palette: it takes a hand-written list of
 * foreground/background pairs and proves each meets AA. Necessary, and not
 * sufficient — it says nothing about which pairs the code actually produces. A
 * token used somewhere the audit was never told to look is invisible to it.
 *
 * Not hypothetical. `--k-ink-2` is a GROUND colour in both themes (`#003252`
 * light, `#0a1f2e` dark), but its name lands in the middle of the text ramp
 * (`ink-3`, `ink-2`, `ink`) and the dark block lists it inside the comment
 * describing that ramp. It was used as body text in eleven places across the
 * first tracker screens. Light mode rendered dark blue on white and looked
 * deliberate; dark mode rendered navy text on a navy card. The palette audit
 * passed the whole time, because `ink-2 on paper` was not a pair it had been
 * given.
 *
 * TWO NAMESPACES COLLIDE IN ONE UTILITY. Tailwind builds `text-*` from both
 * `--color-*` and `--text-*`, so `text-k-mute` is a colour and `text-k-body` is
 * a font size. The colour universe is therefore read from the stylesheet rather
 * than guessed; a first version of this test guessed, and flagged thirty font
 * sizes as unknown colours.
 */

const SRC_DIRS = ["app", "components"];
const CSS = readFileSync(join("app", "globals.css"), "utf8");

/** Every token exposed as a COLOUR utility. The size namespace is not ours. */
const COLOUR_TOKENS = new Set(
  [...CSS.matchAll(/^\s*--color-k-([a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
);

/**
 * SURFACES. Using one as a text colour is the bug above: whether it happens to
 * be readable depends entirely on which theme you looked at.
 */
const GROUND_ONLY = new Set(["paper", "surface", "ink-2", "line", "line-2", "field"]);

/**
 * Saturated fills. Legitimate for an ICON or a glyph, which the handoff holds
 * to 3:1 as essential UI, and wrong for body text, several of which fail AA by
 * design. This test cannot tell an `<svg>` from a paragraph, so it permits them
 * and leaves the ratio itself to the contrast audit — the split exists to make
 * the distinction explicit rather than accidental.
 */
const FILL_ICON_OK = new Set(["risk", "warn", "ok", "cyan", "sky", "teal", "green", "olive", "grey"]);

/** The text ramp, the text-safe hue pairs, and the primary. */
const TEXT_OK = new Set([
  "ink",
  "ink-3",
  "mute",
  "mute-2",
  "primary",
  "primary-hover",
  "text-red",
  "text-amber",
  "text-green",
  "text-cyan",
  "text-sky",
  "text-olive",
  "text-teal",
  "text-grey",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

interface Use {
  file: string;
  line: number;
  token: string;
  text: string;
}

/**
 * Every `text-k-*` in the tree that names a COLOUR.
 *
 * Variant prefixes are matched too (`hover:`, `dark:`, `md:`) — a token misused
 * only on hover is still misused.
 */
function textColourUses(): Use[] {
  const uses: Use[] = [];
  for (const dir of SRC_DIRS) {
    for (const file of sourceFiles(dir)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((text, i) => {
          for (const m of text.matchAll(
            /(?:^|["'`\s:{])(?:[a-z-]+:)*text-k-([a-z0-9-]+)/g,
          )) {
            if (COLOUR_TOKENS.has(m[1])) {
              uses.push({ file, line: i + 1, token: m[1], text: text.trim() });
            }
          }
        });
    }
  }
  return uses;
}

describe("design token usage", () => {
  const uses = textColourUses();

  it("finds colour utilities to check (the scan itself works)", () => {
    // Without this, every assertion below passes vacuously the moment the
    // regex, the directory list or the token parse breaks.
    expect(COLOUR_TOKENS.size).toBeGreaterThan(20);
    expect(uses.length).toBeGreaterThan(20);
  });

  it("never uses a ground token as a text colour", () => {
    const bad = uses.filter((u) => GROUND_ONLY.has(u.token));
    expect(
      bad.map(
        (u) =>
          `${u.file}:${u.line} — text-k-${u.token} is a SURFACE token\n    ${u.text}`,
      ),
      "A ground colour used as text is readable in one theme and invisible in the other",
    ).toEqual([]);
  });

  it("only uses tokens classified as text or icon fills", () => {
    const unknown = uses.filter(
      (u) => !TEXT_OK.has(u.token) && !FILL_ICON_OK.has(u.token),
    );
    expect(
      unknown.map(
        (u) =>
          `${u.file}:${u.line} — text-k-${u.token} is unclassified; add it to TEXT_OK, FILL_ICON_OK or GROUND_ONLY`,
      ),
    ).toEqual([]);
  });

  it("classifies every colour token exactly once", () => {
    // Catches both directions of drift: a new token in the stylesheet that
    // nobody decided about, and a stale name left behind by a rename.
    const classified = [...GROUND_ONLY, ...FILL_ICON_OK, ...TEXT_OK];
    const unclassified = [...COLOUR_TOKENS].filter(
      (t) => !classified.includes(t),
    );
    const stale = classified.filter((t) => !COLOUR_TOKENS.has(t));
    const duplicated = classified.filter(
      (t, i) => classified.indexOf(t) !== i,
    );

    expect({ unclassified, stale, duplicated }).toEqual({
      unclassified: [],
      stale: [],
      duplicated: [],
    });
  });
});

/**
 * The blind spot the test above cannot see into: inline `style`.
 *
 * `textColourUses` reads `text-k-*` utility classes. A colour handed over as
 * `style={{ color }}` is invisible to it, and that is exactly where this bug
 * lived — the implementation matrix drew its `✓` and `•` from
 * `rgba(136, 183, 135, .85)` and `rgba(0, 155, 221, .85)`, which are the
 * LIGHT-MODE values of `--k-fill-ok` and `--k-cyan` with the artboard's alpha
 * frozen in. Light mode looked right, so nobody noticed that dark mode left two
 * of the four marks at their light values while `!` and `~`, which used
 * `var(--k-fill-*)` all along, flipped correctly.
 *
 * Scoped to this one file rather than the whole tree on purpose. A blanket ban
 * on colour literals would also flag the Microsoft logo on the sign-in button
 * (brand colours must NOT theme-flip) and the neutral scrim behind the command
 * palette, and an allowlist of judgement calls is a different piece of work
 * from pinning a fixed bug.
 */
describe("implementation matrix status colours", () => {
  const FILE = join("components", "implementation", "matrix-view.tsx");

  /**
   * Comments stripped first, and this is load-bearing rather than tidy: the
   * comment explaining the fix QUOTES the two rgba literals it replaced, so a
   * naive scan would fail on its own explanation.
   */
  const code = readFileSync(FILE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  /**
   * The colours moved out of this file into `STATUS_CELL`, so the assertion
   * moved with them. The two constants this used to name are gone; keeping
   * them alive purely to satisfy a test would have been the tail wagging the
   * dog. What the test is FOR is unchanged: no frozen light-mode colour
   * anywhere near the matrix.
   */
  it("gives every status a themed ground and a themed label", () => {
    const entries = Object.entries(STATUS_CELL);

    // Without this the assertion below passes vacuously the day the map is
    // renamed or emptied.
    expect(entries.length).toBe(STATUSES.length);
    expect(Object.keys(STATUS_CELL).sort()).toEqual([...STATUSES].sort());

    const frozen = entries.flatMap(([status, { fill, ink }]) =>
      [
        ["fill", fill],
        ["ink", ink],
      ]
        .filter(([, v]) => !/^var\(--k-[a-z0-9-]+\)$/.test(v))
        .map(([slot, v]) => `${status}.${slot} = ${v} — a literal cannot change with the theme`),
    );

    expect(frozen).toEqual([]);
  });

  it("carries no colour literal anywhere in the matrix", () => {
    const literals = code
      .split("\n")
      .map((text, i) => ({ line: i + 1, text: text.trim() }))
      .filter(({ text }) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(text))
      .map(({ line, text }) => `${FILE}:${line} — ${text}`);

    expect(
      literals,
      "A hex or rgb() in this file is a theme frozen in place; use a --k-* token",
    ).toEqual([]);
  });
});
