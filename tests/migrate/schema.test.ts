import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

/**
 * Applies the real migration SQL to a real Postgres and asserts the
 * constraints actually behave as intended.
 *
 * PGlite is Postgres compiled to WASM, running in-process — so this exercises
 * the genuine planner and constraint machinery with no Docker daemon, and runs
 * in CI unchanged. A migration that would fail on Supabase fails here first.
 */

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

describe("migration SQL applies and constrains correctly", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    // Supabase has this role; a stock Postgres does not. The v2 DDL grants to
    // it, so create it here to let the files apply verbatim.
    await db.exec(`do $$ begin
      if not exists (select from pg_roles where rolname = 'service_role') then
        create role service_role;
      end if;
    end $$;`);

    for (const f of [
      "0001_baseline_v1_schema.sql",
      "0002_v2_schema.sql",
      "0003_domain_membership.sql",
      "0005_backend_indexes.sql",
    ]) {
      await db.exec(read(f));
    }
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("creates every expected table", async () => {
    const res = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by 1`,
    );
    const tables = res.rows.map((r) => r.table_name);

    for (const t of [
      "clients",
      "users",
      "audit_log",
      "login_ip_throttle",
      "portfolio_snapshots",
      "app_settings",
      "clients_v2",
      "integrations_v2",
      "milestones_v2",
      "modules_v2",
      "phases_v2",
      "ams_work_log_v2",
      "rate_limits",
    ]) {
      expect(tables, `missing table ${t}`).toContain(t);
    }
  });

  it("adds the domain-membership columns with a false default", async () => {
    await db.exec(`insert into clients_v2 (id, name) values ('m1', 'Membership')`);
    const res = await db.query<{
      has_implementation: boolean;
      has_ams: boolean;
    }>(`select has_implementation, has_ams from clients_v2 where id = 'm1'`);
    expect(res.rows[0]).toEqual({ has_implementation: false, has_ams: false });
  });

  it("is re-runnable — applying every migration twice is a no-op", async () => {
    // Everything is `if not exists`, so a partially-applied environment can be
    // brought forward safely. This is what makes the cutover runbook's
    // "just run them in order" instruction true.
    await expect(
      (async () => {
        for (const f of [
          "0002_v2_schema.sql",
          "0003_domain_membership.sql",
          "0005_backend_indexes.sql",
        ]) {
          await db.exec(read(f));
        }
      })(),
    ).resolves.not.toThrow();
  });

  describe("phases: one active row per (module, phase name)", () => {
    beforeAll(async () => {
      await db.exec(`
        insert into clients_v2 (id, name) values ('cp', 'Phase Client');
        insert into modules_v2 (id, client_id, name) values ('mp', 'cp', 'Core HR');
        insert into phases_v2 (id, module_id, client_id, phase_name)
          values ('p1', 'mp', 'cp', 'BPU');
      `);
    });

    it("rejects a duplicate active phase name", async () => {
      await expect(
        db.exec(`insert into phases_v2 (id, module_id, client_id, phase_name)
                 values ('p2', 'mp', 'cp', 'BPU')`),
      ).rejects.toThrow();
    });

    it("allows the duplicate once the original is archived", async () => {
      // Soft-delete has to leave the name reusable, or renaming/recreating a
      // phase would be permanently blocked by a row nobody can see.
      await db.exec(`update phases_v2 set archived = true where id = 'p1'`);
      await expect(
        db.exec(`insert into phases_v2 (id, module_id, client_id, phase_name)
                 values ('p3', 'mp', 'cp', 'BPU')`),
      ).resolves.not.toThrow();
    });
  });

  describe("clients: case-insensitive unique name (migration 0004)", () => {
    it("applies cleanly when there are no duplicates", async () => {
      await db.exec(`delete from clients_v2 where id in ('dupa','dupb')`);
      await expect(db.exec(read("0004_client_name_ci_unique.sql"))).resolves.not.toThrow();
    });

    it("rejects names differing only by case or surrounding space", async () => {
      await db.exec(`insert into clients_v2 (id, name) values ('dupa', 'Vantage Logistics')`);
      await expect(
        db.exec(`insert into clients_v2 (id, name) values ('dupb', '  vantage logistics ')`),
      ).rejects.toThrow();
    });

    it("frees the name again once the original is archived", async () => {
      await db.exec(`update clients_v2 set archived = true where id = 'dupa'`);
      await expect(
        db.exec(`insert into clients_v2 (id, name) values ('dupb', 'vantage logistics')`),
      ).resolves.not.toThrow();
    });
  });

  describe("referential integrity", () => {
    it("refuses to hard-delete a client that still has children", async () => {
      // FKs are `on delete restrict` by design: the app soft-deletes, and a
      // stray DELETE must never silently orphan or cascade away real records.
      await db.exec(`
        insert into clients_v2 (id, name) values ('cfk', 'FK Client');
        insert into integrations_v2 (id, client_id, name) values ('ifk', 'cfk', 'X');
      `);
      await expect(
        db.exec(`delete from clients_v2 where id = 'cfk'`),
      ).rejects.toThrow();
    });

    it("rejects an integration pointing at a client that does not exist", async () => {
      await expect(
        db.exec(`insert into integrations_v2 (id, client_id, name)
                 values ('orphan', 'nope', 'X')`),
      ).rejects.toThrow();
    });
  });

  describe("ams_work_log_v2.date_raised is NOT NULL", () => {
    it("rejects a null date_raised", async () => {
      // This is exactly what the old dual-write hit for any entry missing
      // dateRaised — and it swallowed the failure. The migration's fallback
      // chain exists to prevent it.
      await db.exec(`insert into clients_v2 (id, name) values ('cw', 'WL Client')`);
      await expect(
        db.exec(`insert into ams_work_log_v2 (id, client_id, date_raised)
                 values ('w1', 'cw', null)`),
      ).rejects.toThrow();
    });
  });

  describe("users: case-insensitive unique username (migration 0005)", () => {
    it("rejects usernames differing only by case", async () => {
      // name and password_hash are NOT NULL in the real schema — verified
      // against production, and originally guessed wrong here.
      await db.exec(`insert into users (id, username, name, password_hash, role)
                     values ('u1', 'meera', 'Meera R', 'x', 'admin')`);
      await expect(
        db.exec(`insert into users (id, username, name, password_hash, role)
                 values ('u2', 'Meera', 'Meera R', 'x', 'editor')`),
      ).rejects.toThrow();
    });
  });
});
