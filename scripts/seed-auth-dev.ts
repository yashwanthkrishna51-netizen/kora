/**
 * seed-auth-dev — a local database with users you can actually sign in as.
 *
 *   docker run -d --name kora-pg -e POSTGRES_PASSWORD=postgres \
 *     -p 55432:5432 postgres:16
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres \
 *     pnpm tsx scripts/seed-auth-dev.ts
 *
 * Fabricated accounts only. Real users' passwords are bcrypt hashes that
 * cannot be reversed, and creating a test account in production to work around
 * that would be a write to the live `users` table for a developer convenience.
 *
 * Refuses to run against anything that is not local.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const MIGRATIONS = ["0001_baseline_v1_schema.sql", "0005_backend_indexes.sql"];

/**
 * Generated per run rather than hardcoded, so this file contains no password
 * literal for a scanner to flag — and so two developers never end up sharing a
 * known credential out of convenience. Set KORA_DEV_PASSWORD to pin it across
 * re-seeds.
 */
const PASSWORD =
  process.env.KORA_DEV_PASSWORD ??
  `dev-${crypto.randomBytes(6).toString("base64url")}`;

const ACCOUNTS = [
  {
    id: "dev_admin",
    username: "meera",
    name: "Meera Raghavan",
    email: "meera@example.com",
    role: "admin",
    note: "admin, bcrypt",
  },
  {
    id: "dev_editor",
    username: "arjun",
    name: "Arjun Mehta",
    email: "arjun@example.com",
    role: "editor",
    note: "editor, bcrypt",
  },
  {
    id: "dev_viewer",
    username: "vikram",
    name: "Vikram Shah",
    email: "vikram@example.com",
    role: "viewer",
    note: "viewer, LEGACY SHA-256 — upgrades to bcrypt on first sign-in",
    legacy: true,
  },
  {
    id: "dev_locked",
    username: "locked",
    name: "Locked Account",
    email: "locked@example.com",
    role: "viewer",
    note: "locked for 30 minutes — exercises the 423 path",
    lockedMinutes: 30,
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "\n  DATABASE_URL is not set.\n\n" +
        "  Start a throwaway database and point at it:\n" +
        "    docker run -d --name kora-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16\n" +
        "    DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres pnpm tsx scripts/seed-auth-dev.ts\n",
    );
    process.exit(1);
  }

  const host = new URL(url).hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");

  if (!isLocal) {
    console.error(
      `\n  REFUSING TO RUN — target is ${host}, which is not local.\n` +
        "  This creates accounts with a known password. It must never touch a\n" +
        "  database holding real users.\n",
    );
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    console.log(`\n  Target: ${host} (local)\n`);

    // Supabase provides this role; a stock Postgres image does not, and 0005
    // grants to it. Creating it lets the migration files apply unmodified.
    await sql.unsafe(`
      do $$ begin
        if not exists (select from pg_roles where rolname = 'service_role') then
          create role service_role;
        end if;
      end $$;
    `);

    for (const f of MIGRATIONS) {
      const p = path.resolve(process.cwd(), "db/migrations", f);
      console.log(`  Applying ${f}…`);
      await sql.unsafe(fs.readFileSync(p, "utf8"));
    }

    const hash = await bcrypt.hash(PASSWORD, 12);
    const legacyHash = crypto
      .createHash("sha256")
      .update(PASSWORD)
      .digest("hex");

    for (const a of ACCOUNTS) {
      await sql`
        insert into users ${sql({
          id: a.id,
          username: a.username,
          name: a.name,
          email: a.email,
          role: a.role,
          password_hash: a.legacy ? legacyHash : hash,
          token_version: 0,
          failed_attempts: 0,
          lockout_level: a.lockedMinutes ? 1 : 0,
          locked_until: a.lockedMinutes
            ? new Date(Date.now() + a.lockedMinutes * 60000).toISOString()
            : null,
        })}
        on conflict (id) do update set
          password_hash = excluded.password_hash,
          role          = excluded.role,
          locked_until  = excluded.locked_until,
          lockout_level = excluded.lockout_level,
          failed_attempts = 0,
          token_version = 0
      `;
    }

    console.log("\n  Accounts (all share the same password):\n");
    const width = Math.max(...ACCOUNTS.map((a) => a.username.length));
    for (const a of ACCOUNTS) {
      console.log(`    ${a.username.padEnd(width)}   ${a.note}`);
    }
    console.log(`\n  Password: ${PASSWORD}\n`);
    console.log(
      "  Point the app at the same database and sign in:\n" +
        `    DATABASE_URL=${url} INTEGTRACK_SECRET=dev-secret pnpm dev\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("\n  seed failed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
