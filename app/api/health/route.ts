import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { supabase } from "@/lib/supabase";
import { getGraphToken, azureCredentials } from "@/lib/mail/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — is this deployment actually wired up?
 *
 * Public, because the moment you need it is the moment you cannot sign in. A
 * misconfigured DATABASE_URL made every route fail with a generic 500 and the
 * SSO callback bounce to "temporarily unavailable"; working out that the
 * database was unreachable meant probing the login endpoint from outside and
 * inferring it from the status code.
 *
 * WHERE POSSIBLE IT VERIFIES RATHER THAN COUNTS. An earlier version reported
 * `"storage": "configured"` for any non-empty string, which is a much weaker
 * claim than it reads as — pasting a whole `.env` file into a hosting
 * dashboard can append a trailing comment to a value, giving a credential that
 * is present, wrong, and reported as fine. Only the database was genuinely
 * exercised, which is the sole reason the real problem was ever visible.
 *
 * It reports whether each dependency ANSWERS — never a hostname, database
 * name, bucket name, key or driver message.
 */

/** `?deep=1` gates the outbound calls, so the default stays cheap and local. */
async function checkStorage(deep: boolean): Promise<string> {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const url = (process.env.SUPABASE_URL ?? "").trim();
  if (!key || !url) return "MISSING";
  if (!deep) return "configured (add ?deep=1 to verify)";

  try {
    const { error } = await supabase().storage.listBuckets();
    // The driver's message names buckets and hosts; the status is enough.
    return error ? "REJECTED — the key is present but not accepted" : "ok";
  } catch {
    return "REJECTED — could not reach storage";
  }
}

/**
 * Also answers the outstanding question about Mail.Send.
 *
 * An app-only token's `roles` claim lists the APPLICATION permissions actually
 * granted and consented. Empty means mail will fail at runtime with a Graph
 * 403 — which is invisible until a digest silently does not go out.
 */
async function checkSso(deep: boolean): Promise<string> {
  if (!azureCredentials()) return "MISSING";
  if (!deep) return "configured (add ?deep=1 to verify)";

  try {
    const token = await getGraphToken();
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    ) as { roles?: string[] };
    const roles = claims.roles ?? [];
    return roles.includes("Mail.Send")
      ? "ok (Mail.Send granted)"
      : "ok, but NO application permissions consented — mail will 403";
  } catch {
    return "REJECTED — the client secret is present but not accepted";
  }
}

export async function GET(req: NextRequest) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const checks: Record<string, string> = {};

  const t0 = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    checks.database = `ok (${Date.now() - t0}ms)`;
  } catch {
    // Deliberately not the driver's message: it names hosts and users.
    checks.database = "unreachable";
  }

  const present = (name: string) =>
    (process.env[name] ?? "").trim() ? "configured" : "MISSING";

  checks.sessionSecret = present("INTEGTRACK_SECRET");
  checks.appUrl = present("KORA_APP_URL");
  checks.cron = present("CRON_SECRET");
  checks.mailSender = present("AZURE_DEFAULT_MAIL_SENDER");
  checks.storage = await checkStorage(deep);
  checks.sso = await checkSso(deep);

  // AFTER every other assignment, deliberately: these are more specific than
  // "configured" and must not be overwritten by it. An earlier ordering had
  // present() clobber the appUrl warning two lines later.
  //
  // And only in PRODUCTION. Locally, localhost is the correct answer for both
  // — that is the whole point of the local dev database. Flagging it in
  // development makes `pnpm dev` report ok:false permanently, which trains
  // everyone to ignore the one endpoint whose job is to be believed.
  if (process.env.NODE_ENV === "production") {
    const dbUrl = process.env.DATABASE_URL ?? "";
    if (dbUrl && /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(dbUrl)) {
      checks.database = "points at LOCALHOST — .env.local copied into the deployment?";
    }

    const appHost = (() => {
      try {
        return new URL(process.env.KORA_APP_URL ?? "").host;
      } catch {
        return "";
      }
    })();
    if (appHost.startsWith("localhost")) {
      checks.appUrl = "points at LOCALHOST — SSO will redirect to a laptop";
    }
  }

  const bad = (v: string) =>
    v.includes("MISSING") ||
    v.includes("LOCALHOST") ||
    v.includes("REJECTED") ||
    v === "unreachable";

  const healthy = !Object.values(checks).some(bad);

  return NextResponse.json(
    { ok: healthy, checks },
    { status: healthy ? 200 : 503 },
  );
}
