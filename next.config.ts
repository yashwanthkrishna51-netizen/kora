import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * This file was the untouched scaffold until now. `db/migrations/CRONS.md` said
 * headers would "land with the frontend work in stage 3"; stage 3 shipped and
 * they did not, so the app has been servable in an iframe, without HSTS, and
 * leaking full URLs in the referrer.
 *
 * WHY CSP IS NOT `script-src 'self'` YET, stated plainly rather than left as a
 * silent gap. Two things in this app currently require `'unsafe-inline'`:
 *
 *   1. The no-flash theme script (`app/layout.tsx`) is inline by necessity — it
 *      has to run before first paint or every dark-mode user gets a white
 *      flash. Nonce-ing it means threading a per-request nonce from `proxy.ts`
 *      into the layout, which is real work and needs its own verification.
 *   2. ~56 `style={{...}}` sites carry values computed from the design tokens
 *      (status fills, gauge sweeps, grid templates). Those need `style-src
 *      'unsafe-inline'` regardless until they move to CSS custom properties.
 *
 * So this ships the headers that are unconditional wins today —
 * `frame-ancestors` (the app is clickjackable without it), HSTS,
 * `Referrer-Policy`, `X-Content-Type-Options`, and a CSP that already locks
 * down `object-src`, `base-uri`, `form-action` and `connect-src` — and leaves
 * `script-src` honest about what it permits. Tightening it is a tracked task,
 * not an oversight.
 */

/** Everything the app is allowed to talk to. Deliberately short. */
const CSP = [
  "default-src 'self'",
  // Google Fonts is the only external origin: next/font/google inlines the CSS
  // at build time but the font FILES are still fetched from gstatic.
  "font-src 'self' https://fonts.gstatic.com data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // See the note above. 'unsafe-inline' is the no-flash script; Next's own
  // hydration payload needs 'unsafe-eval' in development only.
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  // Attachment thumbnails come back as signed Supabase URLs.
  "img-src 'self' data: blob: https://*.supabase.co",
  // The app talks to itself, to Supabase storage, and to nothing else. Graph
  // and the database are reached server-side only.
  "connect-src 'self' https://*.supabase.co",
  // Microsoft's sign-in page is a top-level navigation, not a frame.
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // Where a <form> may post. The SSO round trip returns via a GET redirect, so
  // 'self' is sufficient.
  "form-action 'self'",
  // The clickjacking control. An internal tool with session cookies must never
  // be framed.
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          // Two years, subdomains included. Vercel serves HTTPS only, so there
          // is no downgrade risk in setting this.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          // Belt and braces with frame-ancestors, for anything that predates it.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // URLs here carry client ids and the ?next= deep link. Send the
          // origin to other sites, never the path.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app asks for none of these; saying so stops a future dependency
          // asking on its behalf.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
