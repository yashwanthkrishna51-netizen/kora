import fs from "node:fs";
import path from "node:path";

/**
 * Reads the design tokens straight out of app/globals.css.
 *
 * Deliberately parsed rather than duplicated in TypeScript. A hand-maintained
 * copy of the palette would drift from the stylesheet the moment someone
 * tweaked a colour, and an audit that measures a stale copy is worse than no
 * audit — it reports "all pass" about values nobody is shipping.
 *
 * The stylesheet is the single source of truth; this just makes it readable
 * from tests.
 */

const CSS = path.resolve(process.cwd(), "app/globals.css");

export type Theme = "light" | "dark";

/**
 * Extracts the body of the first `selector { ... }` rule.
 *
 * Matches the selector immediately followed by `{`, not merely the first
 * textual occurrence: `.dark` also appears inside
 * `@custom-variant dark (&:where(.dark, .dark *))` near the top of the file,
 * and matching that yields the wrong block — silently, since it still parses.
 */
function blockFor(css: string, selector: string): string {
  const re = new RegExp(
    `(^|[};\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
    "m",
  );
  const found = css.match(re);
  if (!found || found.index === undefined) {
    throw new Error(`selector not found: ${selector}`);
  }
  const start = found.index;
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in ${selector}`);
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Strip comments so a commented-out token can't be read as live.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of clean.split(";")) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/\s+/g, " ").trim();
  }
  return out;
}

/**
 * Resolves `var(--x)` chains so a token defined in terms of another still
 * yields a real colour. Bounded to avoid spinning on a circular definition.
 */
function resolve(
  value: string,
  scope: Record<string, string>,
  depth = 0,
): string {
  if (depth > 10) return value;
  const m = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (!m) return value;
  const referenced = scope[m[1]];
  if (referenced !== undefined) return resolve(referenced, scope, depth + 1);
  return m[2] ? resolve(m[2].trim(), scope, depth + 1) : value;
}

export function readTokens(theme: Theme): Record<string, string> {
  const css = fs.readFileSync(CSS, "utf8");

  const light = declarations(blockFor(css, ":root"));
  // Dark overrides light: any token the dark block doesn't restate is
  // inherited, exactly as the cascade does at runtime.
  const scope =
    theme === "light"
      ? light
      : { ...light, ...declarations(blockFor(css, ".dark")) };

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(scope)) out[k] = resolve(v, scope);
  return out;
}

/** Token names the dark block must override, with why it matters. */
export const MUST_OVERRIDE_IN_DARK: Array<[string, string]> = [
  ["--k-primary", "brand blue is unreadable on a dark ground"],
  ["--k-paper", "card surface"],
  ["--k-surface", "page ground"],
  ["--k-ink", "body text"],
  ["--k-ink-3", "secondary body text"],
  ["--k-mute", "secondary text"],
  ["--k-mute-2", "label text"],
  ["--k-line", "structural borders"],
  ["--k-line-2", "inner dividers"],
  ["--k-field", "form control borders"],
  ["--k-text-red", "text-safe pairs invert: they must get lighter, not darker"],
  ["--k-text-amber", "text-safe pair"],
  ["--k-text-green", "text-safe pair"],
  ["--k-text-cyan", "text-safe pair"],
  ["--k-text-sky", "text-safe pair"],
  ["--k-text-olive", "text-safe pair"],
  ["--k-text-teal", "text-safe pair"],
  ["--k-text-grey", "text-safe pair"],
];
