/**
 * parity-compare — proves the READ PATH, not the data.
 *
 *   pnpm parity:compare
 *   pnpm parity:compare --client <id>     # one client, full diff
 *   pnpm parity:compare --limit 5
 *
 * `migrate:verify` already proves the v2 tables hold the v1 data faithfully.
 * It cannot prove the application returns it: verify reads v2 with raw SQL,
 * while the API reads it through Drizzle. Those are different code paths, and
 * a bug in the one verify does not exercise is invisible to it.
 *
 * That is not hypothetical. `toV1Shape` originally read snake_case keys, which
 * is what raw SQL returns. Drizzle returns camelCase. Every mismatched lookup
 * yielded undefined rather than throwing, so the API served clients that were
 * structurally valid and missing their modules, work log and every date, while
 * verify stayed green.
 *
 * So this compares the ACTUAL production query code — getClientTrees(), the
 * same function the route handler calls — against the v1 jsonb reconstructed
 * through the migration mapper. Read-only; touches nothing.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { announce, connect, resolveTarget } from "./migrate/lib/db";
import { fromPostgresJs } from "./migrate/lib/executor";
import { readV1Clients } from "./migrate/lib/read-v1";
import { planBackfill } from "./migrate/lib/backfill-core";
import { mappedToV1Shape } from "@/lib/db/inverse";
import { getClientTrees } from "@/lib/db/queries/clients";
import { writeReport } from "./migrate/lib/report";
import * as schema from "@/lib/db/schema";
import type { AnyDb } from "@/lib/auth/db-types";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const onlyClient = flag("client");
const limit = Number(flag("limit") ?? 0) || undefined;

interface Diff {
  clientId: string;
  clientName: string;
  path: string;
  expected: unknown;
  actual: unknown;
}

/**
 * First structural difference between two values, as a dotted path.
 *
 * A whole-object JSON compare answers "are these the same" but not "where do
 * they differ", and on a client carrying 40 phases the diff output is
 * unreadable. This walks until it finds something and reports the location.
 */
function firstDiff(
  expected: unknown,
  actual: unknown,
  path = "",
  depth = 0,
): { path: string; expected: unknown; actual: unknown } | null {
  if (depth > 12) return null;

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { path, expected, actual };
    }
    if (expected.length !== actual.length) {
      return {
        path: `${path}.length`,
        expected: expected.length,
        actual: actual.length,
      };
    }
    for (let i = 0; i < expected.length; i++) {
      const d = firstDiff(expected[i], actual[i], `${path}[${i}]`, depth + 1);
      if (d) return d;
    }
    return null;
  }

  const bothObjects =
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object";

  if (bothObjects) {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    // Key PRESENCE is compared, not just values: the domain sentinel is
    // carried by whether `modules` exists at all, so a missing key and a key
    // set to undefined are different outcomes and must not compare equal.
    const keys = [...new Set([...Object.keys(e), ...Object.keys(a)])].sort();
    for (const k of keys) {
      if (k in e !== k in a) {
        return {
          path: `${path}.${k}`,
          expected: k in e ? e[k] : "<key absent>",
          actual: k in a ? a[k] : "<key absent>",
        };
      }
      const d = firstDiff(e[k], a[k], `${path}.${k}`, depth + 1);
      if (d) return d;
    }
    return null;
  }

  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    return { path: path || "<root>", expected, actual };
  }
  return null;
}

/**
 * Deep-remove every `_v`, leaving the rest of the structure identical.
 *
 * Rebuilds rather than deleting in place: the tree belongs to the caller and
 * this gate must not mutate the thing it is measuring.
 */
function stripTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTokens);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "_v") continue;
      out[k] = stripTokens(v);
    }
    return out;
  }
  return value;
}

async function main() {
  const target = resolveTarget();
  announce("parity-compare — read path vs v1 source", target, "read-only");

  const sql = connect(target);
  const exec = fromPostgresJs(sql);
  const db = drizzle(sql, { schema }) as unknown as AnyDb;

  try {
    // Ground truth: v1 jsonb, put through the same mapper the backfill used
    // and reconstructed into v1 shape. Comparing against raw v1 instead would
    // flag every intentional transformation — re-minted phase ids, stripped
    // signed URLs, coerced dates — as a failure.
    const v1 = await readV1Clients(exec);
    const plan = planBackfill(v1);

    let mapped = plan.mapped;
    if (onlyClient) mapped = mapped.filter((m) => m.client.id === onlyClient);
    if (limit) mapped = mapped.slice(0, limit);

    if (!mapped.length) {
      console.error(
        onlyClient
          ? `  No v1 client with id "${onlyClient}".\n`
          : "  No v1 clients found.\n",
      );
      process.exit(1);
    }

    const ids = mapped.map((m) => String(m.client.id));

    // The real thing: the exact function the route handler calls.
    const actual = await getClientTrees(db, ids);
    const byId = new Map(actual.map((t) => [t.id, t]));

    const diffs: Diff[] = [];
    let compared = 0;

    for (const m of mapped) {
      const id = String(m.client.id);
      const name = String(m.client.name ?? "");
      const tree = byId.get(id);

      if (!tree) {
        diffs.push({
          clientId: id,
          clientName: name,
          path: "<client>",
          expected: "present",
          actual: "missing from the API read",
        });
        continue;
      }

      // `_v` is an API addition with no v1 counterpart. Removed rather than
      // ignored inside firstDiff, so an unexpected extra key still fails.
      //
      // STRIPPED AT EVERY DEPTH, not just the top. Children carry tokens too
      // now — they have to, or nothing under a client can be edited — and this
      // gate compares against the v1 jsonb, which has none. Leaving them in
      // would make every integration, milestone, module, phase and work-log row
      // read as a difference, turning the one check that proves the API still
      // matches production permanently red for a known reason.
      const { _v } = tree;
      const served = stripTokens(tree) as Record<string, unknown>;
      if (!_v) {
        diffs.push({
          clientId: id, clientName: name, path: "_v",
          expected: "an OCC token", actual: _v,
        });
      }

      const d = firstDiff(mappedToV1Shape(m), served);
      if (d) diffs.push({ clientId: id, clientName: name, ...d });
      compared++;
    }

    const extra = actual.filter((t) => !ids.includes(t.id));
    for (const t of extra) {
      diffs.push({
        clientId: t.id, clientName: t.name, path: "<client>",
        expected: "not requested", actual: "returned by the API",
      });
    }

    console.log(`  clients compared : ${compared}`);
    console.log(`  differences      : ${diffs.length}\n`);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = writeReport(`parity-${stamp}`, {
      target: target.label,
      generatedAt: new Date().toISOString(),
      compared,
      diffs,
    });
    console.log(`  Report: ${file}\n`);

    if (diffs.length) {
      console.error(`  FAIL — the API read does not match the v1 source:\n`);
      for (const d of diffs.slice(0, 20)) {
        console.error(`    ${d.clientName} (${d.clientId})`);
        console.error(`      at       ${d.path}`);
        console.error(`      expected ${JSON.stringify(d.expected)?.slice(0, 160)}`);
        console.error(`      actual   ${JSON.stringify(d.actual)?.slice(0, 160)}\n`);
      }
      if (diffs.length > 20) {
        console.error(`    … ${diffs.length - 20} more in the report.\n`);
      }
      process.exit(1);
    }

    console.log("  PASS — every client the API serves matches its v1 source.\n");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\n  parity-compare failed:\n");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
