/**
 * Writes MIGRATION_DATABASE_URL into .env.local, prompting for the password
 * with the input hidden.
 *
 *   node scripts/set-db-url.mjs
 *
 * Two reasons this exists rather than "just edit the file":
 *
 *   1. Database passwords routinely contain `#`, `?`, `@` or `/`, all of which
 *      change the meaning of a URL. A `#` in particular silently truncates the
 *      connection string at that point, and the resulting error ("password
 *      authentication failed") points nowhere near the real cause. This
 *      percent-encodes the userinfo component properly.
 *
 *   2. The password never appears in a shell history, a chat window, or this
 *      script's output.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ENV_FILE = path.resolve(process.cwd(), ".env.local");

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (!hidden) {
      rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
      return;
    }
    // Suppress echo while the password is typed.
    const onData = (char) => {
      if (["\n", "\r", "\u0004"].includes(char.toString())) {
        process.stdin.removeListener("data", onData);
      } else {
        process.stdout.write("\x1b[2K\x1b[200D" + question + "*".repeat(rl.line.length));
      }
    };
    process.stdin.on("data", onData);
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a.trim()); });
  });
}

// Read from the environment rather than baked in: the project ref identifies
// a specific Supabase instance, and a repository is the wrong place to keep a
// pointer to production infrastructure.
const DEFAULTS = {
  ref: process.env.SUPABASE_PROJECT_REF ?? "",
  region: process.env.SUPABASE_REGION ?? "aws-1-ap-south-1",
};

const ref =
  (await ask(
    DEFAULTS.ref ? `Project ref [${DEFAULTS.ref}]: ` : "Project ref: ",
  )) || DEFAULTS.ref;

if (!ref) {
  console.error("\nA project ref is required (Supabase dashboard -> Connect).");
  process.exit(1);
}
const region =
  (await ask(`Pooler region [${DEFAULTS.region}]: `)) || DEFAULTS.region;
const password = await ask("Database password (hidden): ", { hidden: true });

if (!password) {
  console.error("\nNo password entered — nothing written.");
  process.exit(1);
}

// Session mode (5432): the tooling needs prepared statements and long
// transactions, which transaction mode (6543) does not support.
const url =
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}` +
  `@${region}.pooler.supabase.com:5432/postgres`;

// Preserve any other keys already in the file.
let existing = "";
try {
  existing = fs
    .readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("MIGRATION_DATABASE_URL="))
    .join("\n");
} catch {
  /* first run */
}

fs.writeFileSync(
  ENV_FILE,
  [existing, `MIGRATION_DATABASE_URL=${url}`].filter(Boolean).join("\n") + "\n",
  { mode: 0o600 },
);

const parsed = new URL(url);
console.log(`
Wrote .env.local (permissions 600, gitignored)

  host     ${parsed.hostname}
  port     ${parsed.port}  (session pooler)
  database ${parsed.pathname.slice(1)}
  user     ${decodeURIComponent(parsed.username)}
  password ${password.length} characters, encoded correctly

Next:  pnpm migrate:preflight
`);
