/**
 * verify-occ — proves the conflict contract against a REAL running server.
 *
 *   pnpm dev            (in another terminal)
 *   pnpm verify:occ
 *
 * Why this exists, and why it is not a test.
 *
 * The component tests mock `fetch`. They assert that the client heals correctly
 * from a 409 whose body I wrote by hand — so both halves are pinned to my
 * belief about what the server sends, and if that belief were wrong every test
 * would still pass while healing silently produced an empty row in production.
 * That is the same shape as the `toV1Shape` bug: snake against camel, every
 * lookup undefined, the result structurally valid and empty.
 *
 * `verify-admin-lock.ts` exists for the same class of reason — PGlite is
 * single-connection, so a race cannot be produced there and a passing
 * sequential test proved nothing. This is that argument one level up: nothing
 * exercised the client's conflict path against a real HTTP response.
 *
 * So: two real sessions, a genuine stale write, and assertions on the ACTUAL
 * wire body. Local Postgres only — it refuses anything else, because it writes.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const BASE = process.env.KORA_APP_URL ?? "http://localhost:3000";
const PASSWORD = process.env.KORA_DEV_PASSWORD ?? "devpass12345";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail });
};

async function signIn(username: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(
      `Could not sign in as ${username} (${res.status}). Seed the dev database first: pnpm seed:auth`,
    );
  }
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("Login succeeded but set no cookie.");
  return cookie;
}

async function main() {
  // WRITES. Refuse anything that is not a local database, the same guard
  // verify-admin-lock uses.
  const dbUrl = process.env.DATABASE_URL ?? "";
  const host = dbUrl ? new URL(dbUrl).hostname : "";
  if (!(host === "localhost" || host === "127.0.0.1" || host.endsWith(".local"))) {
    console.error(
      `\n  REFUSING TO RUN. DATABASE_URL points at "${host || "(unset)"}".\n` +
        "  This script performs real writes and is for a local database only.\n",
    );
    process.exit(1);
  }

  console.log(`\n  verify-occ — ${BASE}\n`);

  const alice = await signIn("meera");
  const bob = await signIn("arjun");

  const headers = (cookie: string, extra: Record<string, string> = {}) => ({
    cookie,
    "content-type": "application/json",
    "sec-fetch-site": "same-origin",
    ...extra,
  });

  // Pick any client. Both sessions read the same row and the same token.
  const listed = (await (
    await fetch(`${BASE}/api/clients`, { headers: headers(alice) })
  ).json()) as { clients: { id: string; name: string; _v: string }[] };
  const target = listed.clients[0];
  if (!target) throw new Error("No clients in the local database. Run: pnpm seed:dev");

  const tree = (await (
    await fetch(`${BASE}/api/clients/${target.id}`, { headers: headers(alice) })
  ).json()) as { client: Record<string, unknown> };
  const sharedToken = String(tree.client._v);
  const originalDescription = String(tree.client.description ?? "");

  console.log(`  client : ${target.name}`);
  console.log(`  token  : ${sharedToken}\n`);

  /* ------------------------------------------------- 1. the winning write */

  const winner = await fetch(`${BASE}/api/clients/${target.id}`, {
    method: "PATCH",
    headers: headers(alice, { "if-match": sharedToken }),
    body: JSON.stringify({ description: "written by the first session" }),
  });
  check("the first session's write succeeds", winner.status === 200, `HTTP ${winner.status}`);

  /* --------------------------------------------- 2. the losing write, 409 */

  const loser = await fetch(`${BASE}/api/clients/${target.id}`, {
    method: "PATCH",
    // The SAME token — this session never saw the first write.
    headers: headers(bob, { "if-match": sharedToken }),
    body: JSON.stringify({ description: "written by the second session" }),
  });
  const body = (await loser.json()) as Record<string, unknown>;

  check("the stale write is refused with 409", loser.status === 409, `HTTP ${loser.status}`);
  check('carries code "conflict"', body.code === "conflict", String(body.code));
  check("carries the entity and id", body.entity === "client" && body.id === target.id);
  check("carries `current` to heal from", !!body.current && typeof body.current === "object");

  const current = (body.current ?? {}) as Record<string, unknown>;

  // THE POINT OF THIS SCRIPT. The client converts these keys before merging
  // them into a camelCase cache; if the real shape ever stopped being
  // snake_case, every mocked test would still pass.
  check(
    "`current` is snake_case, as the client's normaliser assumes",
    "man_day_rate" in current && "has_ams" in current && !("manDayRate" in current),
    Object.keys(current).slice(0, 6).join(", "),
  );
  check(
    "`current` carries a usable OCC token",
    typeof current._v === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(String(current._v)),
    String(current._v),
  );
  check(
    "`current` shows the WINNER's value, not the loser's",
    current.description === "written by the first session",
    String(current.description),
  );

  /* --------------------------------------- 3. healing from `current` works */

  const healed = await fetch(`${BASE}/api/clients/${target.id}`, {
    method: "PATCH",
    headers: headers(bob, { "if-match": String(current._v) }),
    body: JSON.stringify({ description: "retried after healing" }),
  });
  check(
    "retrying with the token from `current` succeeds",
    healed.status === 200,
    `HTTP ${healed.status}`,
  );

  /* -------------------------------------------- 4. a write with no If-Match */

  const noHeader = await fetch(`${BASE}/api/clients/${target.id}`, {
    method: "PATCH",
    headers: headers(bob),
    body: JSON.stringify({ description: "no precondition" }),
  });
  const noHeaderBody = (await noHeader.json()) as Record<string, unknown>;
  check(
    "a write with no If-Match is refused with 428",
    noHeader.status === 428 && noHeaderBody.code === "precondition_required",
    `HTTP ${noHeader.status} ${noHeaderBody.code}`,
  );

  /* ------------------------------------------------------------- clean up */

  const finalTree = (await (
    await fetch(`${BASE}/api/clients/${target.id}`, { headers: headers(alice) })
  ).json()) as { client: Record<string, unknown> };
  await fetch(`${BASE}/api/clients/${target.id}`, {
    method: "PATCH",
    headers: headers(alice, { "if-match": String(finalTree.client._v) }),
    body: JSON.stringify({ description: originalDescription }),
  });

  /* --------------------------------------------------------------- report */

  for (const c of checks) {
    console.log(
      `  ${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.detail && !c.ok ? `  -> ${c.detail}` : ""}`,
    );
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(
    failed.length
      ? `\n  FAIL — ${failed.length} of ${checks.length} checks did not hold.\n`
      : `\n  PASS — all ${checks.length} checks hold against a real server.\n`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
