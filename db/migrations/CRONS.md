# Scheduled jobs

Declared in `vercel.json`. Two of them, which is the Hobby-plan maximum.

| Path | Schedule (UTC) | IST | What |
|---|---|---|---|
| `/api/cron/backup` | `0 3 * * *` | 08:30 | Dumps the v2 tables + redacted users to `kora-backups`, prunes past 30 days |
| `/api/cron/daily-digest` | `30 3 * * *` | 09:00 | Per-assignee reminder mail |

Both are UTC — Vercel's scheduler has no notion of local time.

**The digest schedule cannot move earlier than 05:30 IST.** `todayStr()` in
`lib/utils/dates.ts` derives the current date in UTC, so a run before that
would compute yesterday's date in India and every "due today" label would be
off by one. 03:30 UTC leaves two hours of margin.

**Hobby fires these approximately.** Up to ~59 minutes late; v1's backups land
at 03:24 consistently. The digest therefore arrives somewhere in the 9–10am
hour, which is what people already experience.

**Both endpoints answer GET and POST.** Vercel Cron issues GET; POST is the
admin "run now" path, so a prefetch or a crawler cannot fire a job that writes
a database dump or sends twenty emails. The digest's POST accepts `?dryRun=1`.

`CRON_SECRET` is mandatory. With it unset both endpoints return 503 — never
open. The old app's backup cron wrapped its whole auth check in
`if (CRON_SECRET)`, so a missing variable silently removed authentication from
an endpoint that dumps every user row.

## Not here

Security headers and CSP belong in `next.config.ts` `headers()`, not in
`vercel.json`. The old app kept them here because it was a static site with no
framework to put them in. Their absence from this file is deliberate, not an
oversight — they land with the frontend work in stage 3.

## At cutover

**Remove the two cron entries from the OLD app's `vercel.json`.** Until that
happens both apps run their own digest and everyone receives two emails.
