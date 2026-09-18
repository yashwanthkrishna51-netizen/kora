/**
 * verify-admin — proves step 16's admin actions round-trip against a REAL server.
 *
 *   pnpm dev            (in another terminal)
 *   pnpm verify:admin
 *
 * Why this is a script and not a test, for the third time in this project.
 *
 * The component tests mock `fetch`, so they prove the UI calls what I believe
 * the routes accept. The route tests run against PGlite with a hand-built
 * NextRequest, so they prove the handlers behave — but PGlite is
 * single-connection, and neither layer exercises the two together over HTTP
 * with a real cookie.
 *
 * The admin screen is where that gap bites hardest: every action here is one an
 * admin reaches for when something is already wrong — an account locked, a
 * person who has left, a session that must die now. "It worked in a mocked
 * test" is not the standard those deserve.
 *
 * Local Postgres only. It creates and deletes a real user, so it refuses to
 * point anywhere else.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const BASE = process.env.KORA_APP_URL ?? "http://localhost:3000";
const PASSWORD = process.env.KORA_DEV_PASSWORD ?? "devpass12345";
const PROBE = "zz.verify.probe";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) =>
  checks.push({ name, ok, detail });

async function signIn(username: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(
      `Could not sign in as ${username} (${res.status}). Seed first: pnpm seed:auth`,
    );
  }
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const headers = (cookie: string, extra: Record<string, string> = {}) => ({
  cookie,
  "content-type": "application/json",
  "sec-fetch-site": "same-origin",
  ...extra,
});

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const host = dbUrl ? new URL(dbUrl).hostname : "";
  if (!(host === "localhost" || host === "127.0.0.1" || host.endsWith(".local"))) {
    console.error(
      `\n  REFUSING TO RUN. DATABASE_URL points at "${host || "(unset)"}".\n` +
        "  This script creates and deletes a real user. Local only.\n",
    );
    process.exit(1);
  }

  console.log(`\n  verify-admin — ${BASE}\n`);

  const admin = await signIn("meera");
  const viewer = await signIn("vikram");

  /* ------------------------------------------------ the role gate, first */

  for (const [label, cookie] of [["viewer", viewer]] as const) {
    const res = await fetch(`${BASE}/api/users`, { headers: headers(cookie) });
    const body = (await res.json()) as { users: Record<string, unknown>[] };
    // A viewer may read the list — assignee dropdowns need it — but must
    // receive the four-field shape with no lockout state and no email.
    const leaked = body.users.some((u) => "lockedUntil" in u || "email" in u);
    check(`${label} receives the reduced user shape`, !leaked);
  }

  const denied = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: headers(viewer),
    body: JSON.stringify({
      username: PROBE, name: "Probe", email: "", role: "viewer", password: "probe12345",
    }),
  });
  check("a viewer cannot create a user", denied.status === 403, `HTTP ${denied.status}`);

  /* --------------------------------------------------------- 1. create */

  // Clean up a previous interrupted run, so the script is re-runnable.
  const existing = (await (
    await fetch(`${BASE}/api/users`, { headers: headers(admin) })
  ).json()) as { users: { id: string; username: string; _v: string }[] };
  const stale = existing.users.find((u) => u.username === PROBE);
  if (stale) {
    await fetch(`${BASE}/api/users/${stale.id}`, {
      method: "DELETE",
      headers: headers(admin, { "if-match": stale._v }),
    });
  }

  const createRes = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: headers(admin),
    body: JSON.stringify({
      username: PROBE,
      name: "Verify Probe",
      email: "probe@example.test",
      role: "viewer",
      password: "probe12345",
    }),
  });
  const created = (await createRes.json()) as { id: string; role: string; _v: string };
  check("admin creates a user", createRes.status === 201, `HTTP ${createRes.status}`);
  check("the new user can sign in immediately", Boolean(
    await signIn(PROBE, "probe12345").catch(() => ""),
  ));

  /* ------------------------------------- 2. the username clash is a 409 */

  const clash = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: headers(admin),
    body: JSON.stringify({
      // Deliberately different CASE: the unique index is case-insensitive, so
      // this must be refused with a message rather than creating a second
      // account that can never sign in unambiguously.
      username: PROBE.toUpperCase(),
      name: "Clash", email: "", role: "viewer", password: "probe12345",
    }),
  });
  check("a case-different username clash is refused", clash.status === 409, `HTTP ${clash.status}`);

  /* ----------------------------------------------- 3. OCC on user writes */

  const noToken = await fetch(`${BASE}/api/users/${created.id}`, {
    method: "PATCH",
    headers: headers(admin),
    body: JSON.stringify({ role: "editor" }),
  });
  check("a user PATCH with no If-Match is refused 428", noToken.status === 428, `HTTP ${noToken.status}`);

  // The token here was read BEFORE the probe signed in above. That is the
  // point: a clean sign-in must not move another admin's OCC token, or the
  // users table produces phantom conflicts all day.
  const roleRes = await fetch(`${BASE}/api/users/${created.id}`, {
    method: "PATCH",
    headers: headers(admin, { "if-match": created._v }),
    body: JSON.stringify({ role: "editor" }),
  });
  const promoted = (await roleRes.json()) as { role: string; _v: string };
  check("admin changes a role", roleRes.status === 200 && promoted.role === "editor",
    `HTTP ${roleRes.status} role=${promoted.role}`);

  const stalePatch = await fetch(`${BASE}/api/users/${created.id}`, {
    method: "PATCH",
    headers: headers(admin, { "if-match": created._v }),
    body: JSON.stringify({ name: "Should Not Land" }),
  });
  check("a stale user PATCH is refused 409", stalePatch.status === 409, `HTTP ${stalePatch.status}`);

  /* -------------------------------------------------- 4. lockout, cleared */

  // Drive a REAL lockout the way a person would: five failed sign-ins.
  for (let i = 0; i < 5; i++) {
    await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ username: PROBE, password: "wrong-password" }),
    });
  }

  const afterFailures = (await (
    await fetch(`${BASE}/api/users`, { headers: headers(admin) })
  ).json()) as { users: { username: string; lockedUntil: string | null }[] };
  const lockedRow = afterFailures.users.find((u) => u.username === PROBE);
  const reallyLocked =
    Boolean(lockedRow?.lockedUntil) &&
    new Date(lockedRow!.lockedUntil!).getTime() > Date.now();
  check("five failures actually lock the account", reallyLocked,
    `lockedUntil=${lockedRow?.lockedUntil ?? "null"}`);

  const blocked = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ username: PROBE, password: "probe12345" }),
  });
  check("the locked account cannot sign in even with the RIGHT password",
    !blocked.ok, `HTTP ${blocked.status}`);

  const clearRes = await fetch(`${BASE}/api/users/${created.id}/clear-lockout`, {
    method: "POST",
    headers: headers(admin),
    body: JSON.stringify({}),
  });
  const cleared = (await clearRes.json()) as {
    message: string;
    networkLocksActive: number;
    networkLocksCleared: number;
  };
  check("clear-lockout succeeds", clearRes.status === 200, `HTTP ${clearRes.status}`);
  check("clear-lockout reports network locks rather than silently clearing them",
    cleared.networkLocksCleared === 0 && typeof cleared.networkLocksActive === "number",
    `active=${cleared.networkLocksActive} cleared=${cleared.networkLocksCleared}`);
  check("the message names the user", cleared.message.includes(PROBE), cleared.message);

  const afterClear = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ username: PROBE, password: "probe12345" }),
  });
  check("the account signs in again once cleared", afterClear.ok, `HTTP ${afterClear.status}`);

  /* ------------------------------------------------------ 5. force logout */

  const probeCookie = afterClear.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  // NOTE the contract: /api/auth/session answers 200 with `{user: null}` for a
  // dead session, deliberately — "nobody is signed in" is the expected answer
  // to "who am I", not an error. So the assertion is on the BODY, not the
  // status. Asserting 401 here passed against a wrong belief and would have
  // gone on passing if force-logout stopped working entirely.
  const sessionOf = async (cookie: string) =>
    (await (
      await fetch(`${BASE}/api/auth/session`, { headers: headers(cookie) })
    ).json()) as { user: { username: string } | null; reason?: string };

  const beforeKick = await sessionOf(probeCookie);
  check("the probe's session is live before the kick",
    beforeKick.user?.username === PROBE, JSON.stringify(beforeKick));

  const kick = await fetch(`${BASE}/api/users/${created.id}/force-logout`, {
    method: "POST",
    headers: headers(admin),
  });
  check("force-logout succeeds", kick.status === 200, `HTTP ${kick.status}`);

  const afterKick = await sessionOf(probeCookie);
  check("the probe's existing cookie stops resolving to a user",
    afterKick.user === null, JSON.stringify(afterKick));
  check("and the reason given is 'revoked', not 'expired'",
    afterKick.reason === "revoked", `reason=${afterKick.reason}`);

  // The admin who pressed the button keeps their own session — force-logout on
  // ONE user must not be force-logout-all wearing a different name.
  const adminStillIn = await sessionOf(admin);
  check("the acting admin is NOT signed out by a single force-logout",
    adminStillIn.user !== null, JSON.stringify(adminStillIn));

  /* ------------------------------------------------------- 6. audit paging */

  const page1 = (await (
    await fetch(`${BASE}/api/audit?limit=5&offset=0`, { headers: headers(admin) })
  ).json()) as { rows: { id: number }[]; total: number; limit: number };
  const page2 = (await (
    await fetch(`${BASE}/api/audit?limit=5&offset=5`, { headers: headers(admin) })
  ).json()) as { rows: { id: number }[]; total: number };
  check("audit page 1 returns rows and a total", page1.rows.length > 0 && page1.total >= page1.rows.length,
    `rows=${page1.rows.length} total=${page1.total}`);
  check("audit page 2 is a DIFFERENT set of rows",
    page1.rows.length > 0 && page2.rows.length > 0 &&
      page1.rows[0].id !== page2.rows[0].id);
  check("audit total is stable across pages", page1.total === page2.total);

  const filtered = (await (
    await fetch(`${BASE}/api/audit?q=Clear%20lockout&limit=5`, { headers: headers(admin) })
  ).json()) as { rows: { action: string }[] };
  check("the q filter matches the action column",
    filtered.rows.length > 0 && filtered.rows.every((r) => /clear lockout/i.test(r.action)),
    `${filtered.rows.length} rows`);

  const auditDenied = await fetch(`${BASE}/api/audit`, { headers: headers(viewer) });
  check("a viewer cannot read the audit log", auditDenied.status === 403, `HTTP ${auditDenied.status}`);

  /* ------------------------------------------------------- 7. both settings */

  const recipients = ["ops@example.test", "OPS@example.test", "second@example.test"];
  const savedRes = await fetch(`${BASE}/api/settings/digest-recipients`, {
    method: "PUT",
    headers: headers(admin),
    body: JSON.stringify({ emails: recipients }),
  });
  const saved = (await savedRes.json()) as { emails: string[] };
  check("digest recipients save", savedRes.status === 200, `HTTP ${savedRes.status}`);
  check("the server dedupes case-insensitively, so the UI must echo the RESPONSE",
    saved.emails.length === 2, `sent 3, stored ${saved.emails.length}`);

  const weightsRes = await fetch(`${BASE}/api/settings/capacity-weights`, {
    method: "PUT",
    headers: headers(admin),
    body: JSON.stringify({ module: 3, pmo: 2, ams: 0.5, cap: 12 }),
  });
  check("capacity weights save", weightsRes.status === 200, `HTTP ${weightsRes.status}`);

  const weightsDenied = await fetch(`${BASE}/api/settings/capacity-weights`, {
    method: "PUT",
    headers: headers(viewer),
    body: JSON.stringify({ module: 99, pmo: 99, ams: 99, cap: 99 }),
  });
  check("a viewer cannot rewrite capacity weights", weightsDenied.status === 403,
    `HTTP ${weightsDenied.status}`);

  /* ------------------------------------------------------- 8. archived list */

  const archivedRes = await fetch(`${BASE}/api/clients?archived=1`, { headers: headers(admin) });
  check("admin reads the archived client list", archivedRes.status === 200, `HTTP ${archivedRes.status}`);
  const archivedDenied = await fetch(`${BASE}/api/clients?archived=1`, { headers: headers(viewer) });
  check("a viewer cannot read the archived list", archivedDenied.status === 403,
    `HTTP ${archivedDenied.status}`);

  /* --------------------------------------------------------- 9. delete */

  const current = (await (
    await fetch(`${BASE}/api/users`, { headers: headers(admin) })
  ).json()) as { users: { id: string; username: string; _v: string }[] };
  const row = current.users.find((u) => u.username === PROBE);
  if (row) {
    const delRes = await fetch(`${BASE}/api/users/${row.id}`, {
      method: "DELETE",
      headers: headers(admin, { "if-match": row._v }),
    });
    check("admin deletes the user", delRes.status === 200, `HTTP ${delRes.status}`);

    const gone = (await (
      await fetch(`${BASE}/api/users`, { headers: headers(admin) })
    ).json()) as { users: { username: string }[] };
    check("the user is really gone", !gone.users.some((u) => u.username === PROBE));
  } else {
    check("admin deletes the user", false, "probe row not found");
  }

  /* ---------------------------------------------------------------- report */

  console.log();
  for (const c of checks) {
    console.log(
      `  ${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.detail && !c.ok ? `  — ${c.detail}` : ""}`,
    );
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(
    `\n  ${failed === 0 ? "PASS" : "FAIL"} — ${checks.length - failed}/${checks.length} checks\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n  ERROR: ${err.message}\n`);
  process.exit(1);
});
