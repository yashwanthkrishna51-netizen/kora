import postgres from "postgres";
import { config as loadEnv } from "dotenv";
import path from "node:path";

/**
 * Database connection for the migration tools.
 *
 * These scripts can point at production, so the design goal is that you can
 * never be unsure which database you are about to touch: every run prints the
 * resolved host and database, and anything destructive additionally requires
 * you to type the environment's name.
 *
 * Uses the SESSION-mode pooler (port 5432), not the transaction pooler the
 * application uses (6543): these scripts run long transactions and rely on
 * prepared statements, which transaction mode does not support.
 */

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

export type Env = "local" | "staging" | "production" | "unknown";

export interface Target {
  url: string;
  host: string;
  database: string;
  env: Env;
  label: string;
}

/**
 * Classifies the target so the tools can decide how loudly to object.
 * Anything on supabase.com that is not explicitly marked staging is treated as
 * production — the safe default is to assume it is real data.
 */
function classify(url: string): { env: Env; host: string; database: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string");
  }

  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, "") || "postgres";

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local") ||
    host === "host.docker.internal"
  ) {
    return { env: "local", host, database };
  }

  if (/staging|scratch|rehearsal/i.test(url)) {
    return { env: "staging", host, database };
  }

  if (host.includes("supabase")) {
    return { env: "production", host, database };
  }

  return { env: "unknown", host, database };
}

export function resolveTarget(): Target {
  const url =
    process.env.MIGRATION_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "";

  if (!url) {
    throw new Error(
      [
        "No database URL found.",
        "",
        "Add one to koraV2/.env.local (gitignored, never committed):",
        "",
        "  MIGRATION_DATABASE_URL=postgresql://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres",
        "",
        "Use the SESSION-mode pooler on port 5432 — not 6543 (no prepared",
        "statements) and not db.<ref>.supabase.co (IPv6-only on the free tier).",
      ].join("\n"),
    );
  }

  const { env, host, database } = classify(url);
  return {
    url,
    host,
    database,
    env,
    label: `${env.toUpperCase()} — ${host}/${database}`,
  };
}

export function connect(target: Target) {
  if (target.url.includes(":6543")) {
    console.warn(
      "\n  WARNING: port 6543 is the transaction pooler. These scripts need\n" +
        "  session mode (5432) for prepared statements and long transactions.\n",
    );
  }

  return postgres(target.url, {
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    // Migration payloads carry whole activity logs; the default is plenty but
    // being explicit avoids surprises on large clients.
    max_lifetime: 60 * 30,
    // Supabase requires TLS, and postgres.js does NOT infer it from the URL
    // unless sslmode is spelled out. Without this the handshake degrades and
    // the pooler reports "password authentication failed" — an error that
    // sends you hunting for a credential problem that isn't there.
    // Local databases get no TLS, since a dev container has none.
    ssl: target.env === "local" ? false : "require",
    onnotice: () => {},
  });
}

/** Prints the banner every tool shows before doing anything. */
export function announce(tool: string, target: Target, mode: string): void {
  const bar = "─".repeat(64);
  console.log(`\n${bar}`);
  console.log(`  ${tool}`);
  console.log(`  target : ${target.label}`);
  console.log(`  mode   : ${mode}`);
  console.log(`${bar}\n`);
}

/**
 * Gate for anything that writes. Requires the operator to type the environment
 * name, so a production run can never happen by reflex or by a stale shell
 * variable. Skipped for local databases, which are disposable by definition.
 */
export async function confirmDestructive(target: Target): Promise<void> {
  if (target.env === "local") return;

  const expected = target.env;
  process.stdout.write(
    `  This WRITES to ${target.label}.\n` +
      `  Type "${expected}" to continue: `,
  );

  const answer = await new Promise<string>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", (d) => {
      process.stdin.pause();
      resolve(d.toString().trim());
    });
  });

  if (answer !== expected) {
    console.error(`\n  Aborted — got "${answer}", expected "${expected}".\n`);
    process.exit(1);
  }
  console.log("");
}
