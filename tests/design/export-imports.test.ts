import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * `lib/export/` must never import the domain functions it shadows.
 *
 * Five names exist twice in this codebase with different behaviour, because
 * `js/export.js` deliberately redefined them for the report:
 *
 *   integSeverityRank · sortIntegWorstFirst · integRiskReason
 *   integStatusSegments · integMilestoneCounts
 *
 * Importing the domain version into a generator type-checks, runs, and produces
 * a client-facing PDF ordered by the wrong rule. `tests/golden/export-helpers`
 * catches it when the function is exercised; this catches it at the import,
 * including in a generator that has no golden coverage yet.
 *
 * It is deliberately a source-text check rather than a runtime one. The failure
 * mode is a wrong import statement, and that is a property of the text.
 */

const EXPORT_DIR = path.resolve(process.cwd(), "lib/export");

const SHADOWED = [
  "integSeverityRank",
  "sortIntegWorstFirst",
  "integRiskReason",
  "integStatusSegments",
  // The counts-shaped half of integStatusSegments, added for the client rail.
  // Same trap, new name: the export report wants its donut slices, not the
  // three-part progress bar.
  "integSegments",
  "integMilestoneCounts",
];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? sourceFiles(path.join(dir, e.name))
        : e.name.endsWith(".ts") || e.name.endsWith(".tsx")
          ? [path.join(dir, e.name)]
          : [],
    );
}

/** Just the `import { … } from "@/lib/domain/integrations"` clauses. */
function domainImportClauses(src: string): string[] {
  const out: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/domain\/integrations["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

describe("lib/export never imports the domain look-alikes", () => {
  it("has files to check", () => {
    // Without this the suite passes vacuously the day someone moves the folder.
    expect(sourceFiles(EXPORT_DIR).length).toBeGreaterThan(0);
  });

  it.each(sourceFiles(EXPORT_DIR).map((f) => [path.relative(process.cwd(), f), f]))(
    "%s",
    (_label, file) => {
      const src = fs.readFileSync(file, "utf8");
      for (const clause of domainImportClauses(src)) {
        for (const name of SHADOWED) {
          // Word-boundary match so `integSeverityRank` does not also flag a
          // deliberate `integSeverityRankSomethingElse`, and so an aliased
          // import (`integSeverityRank as domainRank`) is still caught — the
          // alias is exactly how this mistake gets hidden.
          const re = new RegExp(`\\b${name}\\b`);
          expect(
            re.test(clause),
            `${path.basename(file)} imports \`${name}\` from lib/domain/integrations. ` +
              `The report needs the variant in lib/export/integration-report-helpers.ts — ` +
              `they have the same name and different behaviour.`,
          ).toBe(false);
        }
      }
    },
  );

  it("the export helpers module really does define its own versions", () => {
    // The rule above is only meaningful if the replacements exist. If they were
    // ever deleted, the import ban would pass while nothing worked.
    const src = fs.readFileSync(
      path.join(EXPORT_DIR, "integration-report-helpers.ts"),
      "utf8",
    );
    for (const name of [
      "reportSeverityRank",
      "reportSortWorstFirst",
      "reportRiskReason",
      "reportDonutSegments",
      "reportMilestoneCounts",
    ]) {
      expect(src, `missing ${name}`).toContain(`export function ${name}`);
    }
  });
});
