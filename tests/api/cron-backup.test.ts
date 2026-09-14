import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import { users, clients } from "@/lib/db/schema";
import { requireCronAuth, cronActor } from "@/lib/api/cron-auth";
import {
  collectBackup, backupObjectName, parseBackupStamp, stalePaths,
  SAFE_USER_COLUMNS, KEEP_DAYS,
} from "@/lib/backup/dump";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Cron auth and the nightly backup.
 *
 * Two specific old-app defects are pinned here: the auth check that vanished
 * when CRON_SECRET was unset, and the dump that carried every password hash.
 */

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const readSql = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

let pg: PGlite;
let db: AnyDb;

const SECRET = "a-long-random-cron-secret-value";

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as AnyDb;
  await pg.exec(`do $$ begin
    if not exists (select from pg_roles where rolname='service_role') then
      create role service_role;
    end if; end $$;`);
  for (const f of [
    "0001_baseline_v1_schema.sql",
    "0002_v2_schema.sql",
    "0003_domain_membership.sql",
    "0005_backend_indexes.sql",
    "0006_updated_at_trigger.sql",
  ]) {
    await pg.exec(readSql(f));
  }
}, 60_000);

beforeEach(async () => {
  await pg.exec(
    `truncate table phases_v2, modules_v2, milestones_v2, integrations_v2,
     ams_work_log_v2, clients_v2, users, audit_log restart identity cascade`,
  );
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await pg?.close();
});

const req = (headers: Record<string, string> = {}) =>
  new NextRequest("https://kora.test/api/cron/backup", { method: "GET", headers });

/* =============================================================== cron auth */

describe("cron authentication", () => {
  it("returns 503 when CRON_SECRET is unset — never open", async () => {
    // The old backup cron wrapped its whole check in `if (CRON_SECRET)`, so a
    // missing variable meant no authentication at all on an endpoint that
    // dumps every user row.
    vi.stubEnv("CRON_SECRET", "");
    const err = await requireCronAuth(req(), db).catch((e) => e);
    expect(err.statusCode).toBe(503);
    expect(err.extra.code).toBe("cron_not_configured");
  });

  it("does not touch the database when the secret is unset", async () => {
    // The 503 must be decided before any work; otherwise an unauthenticated
    // caller can still make the server do things.
    vi.stubEnv("CRON_SECRET", "");
    const select = vi.fn();
    await requireCronAuth(req(), { select } as unknown as AnyDb).catch(() => {});
    expect(select).not.toHaveBeenCalled();
  });

  it("accepts the bearer token Vercel sends", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const caller = await requireCronAuth(
      req({ authorization: `Bearer ${SECRET}` }), db,
    );
    expect(caller.kind).toBe("cron");
  });

  it("rejects a wrong secret without crashing on length", async () => {
    // timingSafeEqual throws RangeError on unequal lengths and the caller
    // controls that length, so a naive compare turns a guess into a 500 and
    // leaks the secret's length. Both sides are hashed to 32 bytes first.
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const guess of ["", "x", SECRET.slice(0, -1), SECRET + "x", "y".repeat(9999)]) {
      const err = await requireCronAuth(
        req({ authorization: `Bearer ${guess}` }), db,
      ).catch((e) => e);
      expect(err.statusCode).toBe(401);
    }
  });

  it("does not accept x-vercel-cron as proof of anything", async () => {
    // That header is not authenticated — any caller can set it.
    vi.stubEnv("CRON_SECRET", SECRET);
    const err = await requireCronAuth(req({ "x-vercel-cron": "1" }), db)
      .catch((e) => e);
    expect(err.statusCode).toBe(401);
  });

  it("rejects an unauthenticated caller", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const err = await requireCronAuth(req(), db).catch((e) => e);
    expect(err.statusCode).toBe(401);
  });

  it("attributes the run differently for cron and admin", () => {
    expect(cronActor({ kind: "cron" }, "Backup")).toMatchObject({
      username: null, action: "Backup (scheduled)",
    });
    expect(
      cronActor(
        { kind: "admin", user: { id: "u1", username: "meera", name: "Meera", role: "admin", tokenVersion: 0 } },
        "Backup",
      ),
    ).toMatchObject({ username: "meera", action: "Backup (run manually)" });
  });
});

/* ================================================================== backup */

describe("backup contents", () => {
  beforeEach(async () => {
    await db.insert(users).values([
      { id: "u1", username: "meera", name: "Meera", email: "m@x.com",
        role: "admin", passwordHash: "$2b$12$SECRETHASHVALUE", tokenVersion: 7 },
    ]);
    await db.insert(clients).values([
      { id: "c1", name: "Aster Retail", hasImplementation: true },
      { id: "c2", name: "Archived Co", archived: true },
    ]);
  });

  it("contains no password hash anywhere in the artifact", async () => {
    const artifact = await collectBackup(db, new Date("2026-09-01T03:00:00Z"));
    const blob = JSON.stringify(artifact);

    expect(blob).not.toContain("$2b$");
    expect(blob).not.toContain("SECRETHASHVALUE");
    expect(blob).not.toContain("passwordHash");
    expect(blob).not.toContain("password_hash");
  });

  it("omits token_version, so a restore cannot un-revoke sessions", async () => {
    const artifact = await collectBackup(db, new Date());
    expect(JSON.stringify(artifact)).not.toContain("tokenVersion");
  });

  it("keeps the user fields a restore actually needs", async () => {
    const artifact = await collectBackup(db, new Date());
    expect(artifact.tables.users[0]).toMatchObject({
      id: "u1", username: "meera", name: "Meera", email: "m@x.com", role: "admin",
    });
  });

  it("pins the safe-column list so a new schema column cannot slip in", async () => {
    // If someone adds a sensitive column later, this fails and makes them
    // decide rather than inheriting it silently.
    expect(Object.keys(SAFE_USER_COLUMNS).sort()).toEqual([
      "createdAt", "email", "id", "name", "role", "updatedAt", "username",
    ]);
  });

  it("backs up the v2 tables, not the frozen v1 blob", async () => {
    // The old cron dumped `clients`. Post-cutover that table never changes, so
    // a backup of it restores migration day and nothing since.
    const artifact = await collectBackup(db, new Date());
    expect(Object.keys(artifact.tables)).toContain("clients_v2");
    expect(Object.keys(artifact.tables)).not.toContain("clients");
    expect(artifact.schema).toBe("v2");
  });

  it("includes archived rows — they are what a restore is usually for", async () => {
    const artifact = await collectBackup(db, new Date());
    expect(artifact.counts.clients_v2).toBe(2);
  });

  it("excludes the audit log", async () => {
    expect(Object.keys((await collectBackup(db, new Date())).tables))
      .not.toContain("audit_log");
  });
});

/* =============================================================== retention */

describe("naming and retention", () => {
  it("names objects so a folder sorts chronologically", () => {
    expect(backupObjectName(new Date("2026-09-01T03:24:30Z")))
      .toBe("backups/2026-09-01-03-24-30.json");
  });

  it("round-trips a name back to its timestamp", () => {
    const now = new Date("2026-09-01T03:24:30Z");
    expect(parseBackupStamp(backupObjectName(now))?.toISOString())
      .toBe(now.toISOString());
  });

  it("prunes strictly past the retention window", () => {
    const now = new Date("2026-09-01T03:00:00Z");
    const at = (d: string) => `backups/${d}.json`;
    const names = [
      at("2026-08-31-03-00-00"), // 1 day
      at("2026-08-02-03-00-00"), // 30 days exactly
      at("2026-08-01-03-00-00"), // 31 days
    ];
    expect(stalePaths(names, now)).toEqual([at("2026-08-01-03-00-00")]);
  });

  it("never prunes a name it cannot parse", () => {
    // Deleting on "I could not read the date" is how a prune becomes an
    // incident. Unrecognised files are left alone.
    const names = [
      "backups/README.md",
      "backups/manual-before-cutover.json",
      "backups/not-a-date.json",
    ];
    expect(stalePaths(names, new Date("2030-01-01T00:00:00Z"))).toEqual([]);
  });

  it("keeps 30 days of dumps", () => {
    expect(KEEP_DAYS).toBe(30);
  });
});
