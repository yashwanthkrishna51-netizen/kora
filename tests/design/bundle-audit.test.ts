import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * No export library may be reachable without an `await import()`.
 *
 * `kora/CLAUDE.md` names the four render-blocking CDN tags as the old app's
 * biggest unclaimed performance problem: every page load pulled ~1.3 MB of
 * jsPDF, autotable, SheetJS and PptxGenJS whether or not anyone exported
 * anything. jspdf alone is a 384 KB chunk here. Re-importing that regression is
 * easy — a static `import` and a dynamic one look nearly identical in a diff.
 *
 * ── WHY THIS READS SOURCE RATHER THAN THE BUILD ──
 * The obvious test is to check the built chunks against the route manifest. I
 * wrote that first and it was worthless: Next 16 under Turbopack emits no
 * App Router chunk manifest, so `build-manifest.json` describes only the
 * unused pages router (`/_app`, zero chunks). The test passed while checking
 * essentially nothing, and passed just as happily with a deliberately eager
 * import in place — which is how it was caught.
 *
 * Static imports are what MAKE a module eager, so the rule is enforced where it
 * is decided. This needs no build, cannot be fooled by a manifest format
 * change, and points at the exact line.
 */

const ROOT = process.cwd();
const EXPORT_DIR = path.join(ROOT, "lib", "export");

/** Heavy, and only ever needed once someone asks for a file. */
const HEAVY = ["jspdf", "jspdf-autotable", "write-excel-file"];

/** Modules that pull a heavy library in, so they must be lazy too. */
const GENERATOR_MODULES = /@\/lib\/export\/(integration-pdf|excel|pdf-doc)/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const APP_SOURCES = ["app", "components", "lib"]
  .map((d) => path.join(ROOT, d))
  .filter((d) => fs.existsSync(d))
  .flatMap((d) => sourceFiles(d));

/** `import … from "x"` / `import "x"`, but NOT `import type … from "x"`. */
function staticImportsOf(src: string, spec: string): boolean {
  const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^\\s*import\\s+(?!type\\s)(?:[^'"\\n]*?from\\s*)?["']${escaped}(?:/[^"']*)?["']`,
    "m",
  );
  return re.test(src);
}

describe("bundle audit — export libraries stay lazy", () => {
  it("has sources to check", () => {
    expect(APP_SOURCES.length).toBeGreaterThan(50);
    expect(fs.existsSync(EXPORT_DIR)).toBe(true);
  });

  it("only lib/export may reference a heavy library at all", () => {
    const offenders: string[] = [];
    for (const file of APP_SOURCES) {
      if (file.startsWith(EXPORT_DIR)) continue;
      const src = fs.readFileSync(file, "utf8");
      for (const lib of HEAVY) {
        if (new RegExp(`["']${lib}(?:/[^"']*)?["']`).test(src)) {
          offenders.push(`${path.relative(ROOT, file)} → ${lib}`);
        }
      }
    }
    expect(
      offenders,
      `only lib/export/ may touch these:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("even inside lib/export, a heavy library is only ever dynamically imported", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(EXPORT_DIR)) {
      const src = fs.readFileSync(file, "utf8");
      for (const lib of HEAVY) {
        // `import type` is erased at compile time and costs nothing, so it is
        // allowed — that is how the generators get jsPDF's types.
        if (staticImportsOf(src, lib)) {
          offenders.push(`${path.relative(ROOT, file)} statically imports ${lib}`);
        }
      }
    }
    expect(
      offenders,
      `use \`await import()\`:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no screen statically imports a generator module", () => {
    // The regression that actually matters, and the one a build-output check
    // missed: a screen importing the generator directly drags jspdf into that
    // route's first load, no matter how carefully the generator imports jspdf.
    const offenders: string[] = [];
    for (const file of APP_SOURCES) {
      if (file.startsWith(EXPORT_DIR)) continue;
      const src = fs.readFileSync(file, "utf8");
      for (const line of src.split("\n")) {
        if (/^\s*import\s+(?!type\s)/.test(line) && GENERATOR_MODULES.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}: ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      `these must be \`await import()\` inside the handler:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the generators really are imported dynamically somewhere", () => {
    // Guards the guard. If every call site were deleted the rules above would
    // pass trivially, so assert the intended pattern is actually in use.
    const dynamic = APP_SOURCES.filter((f) => !f.startsWith(EXPORT_DIR))
      .map((f) => fs.readFileSync(f, "utf8"))
      .filter((src) => /await import\(\s*\n?\s*["']@\/lib\/export\//.test(src));
    expect(dynamic.length).toBeGreaterThan(0);
  });
});
