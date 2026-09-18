import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

/**
 * Security headers, pinned.
 *
 * `next.config.ts` was the untouched scaffold until step 16 — no CSP, no HSTS,
 * no frame protection — so the app was servable in an iframe and leaked full
 * URLs (which carry client ids) in the referrer. That went unnoticed because
 * nothing asserted it: a header nobody tests is a header that quietly
 * disappears in the next config edit.
 *
 * This reads the real config rather than a copy, so it fails if the export
 * shape changes as well as if a value does.
 */

async function headerMap(): Promise<Map<string, string>> {
  const groups = await nextConfig.headers!();
  const all = groups.flatMap((g) => g.headers);
  return new Map(all.map((h) => [h.key.toLowerCase(), h.value]));
}

describe("security headers", () => {
  it("applies to every path, not just a subtree", async () => {
    const groups = await nextConfig.headers!();
    expect(groups).toHaveLength(1);
    expect(groups[0].source).toBe("/:path*");
  });

  it("refuses to be framed — the clickjacking control", async () => {
    // An internal tool that holds a session cookie must never render inside
    // someone else's page. Asserted twice because the CSP directive is the
    // modern control and the header is the fallback.
    const h = await headerMap();
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.get("x-frame-options")).toBe("DENY");
  });

  it("does not leak the path in a referrer", async () => {
    // URLs here carry client ids and the ?next= deep link.
    const h = await headerMap();
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets HSTS and nosniff", async () => {
    const h = await headerMap();
    expect(h.get("strict-transport-security")).toMatch(/max-age=\d{7,}/);
    expect(h.get("x-content-type-options")).toBe("nosniff");
  });

  it("locks down the directives that do not need an exception", async () => {
    // These four are the ones with no legitimate use in this app, so they are
    // asserted strictly. `script-src` deliberately is NOT — see the config's
    // own note about the no-flash theme script.
    const csp = (await headerMap()).get("content-security-policy")!;
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-src 'none'");
  });

  it("allows only the origins the app genuinely uses", async () => {
    const csp = (await headerMap()).get("content-security-policy")!;
    // Google Fonts (next/font fetches the files at runtime) and Supabase
    // storage (signed attachment URLs). Nothing else.
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).toContain("connect-src 'self' https://*.supabase.co");
    // The CDN hosts v1 loaded its export libraries from must never come back —
    // bundling them is the plan, and this is the tripwire.
    expect(csp).not.toContain("cdn.jsdelivr.net");
    expect(csp).not.toContain("unpkg.com");
    expect(csp).not.toContain("cdnjs.cloudflare.com");
  });

  it("does not permit eval in a production build", async () => {
    // Development needs it for Next's hydration payload; production does not,
    // and shipping it would undo most of what a CSP is for.
    expect(process.env.NODE_ENV).not.toBe("production");
    const csp = (await headerMap()).get("content-security-policy")!;
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"))!;
    // This suite runs outside production, so assert the branch directly.
    expect(scriptSrc.includes("'unsafe-eval'")).toBe(
      process.env.NODE_ENV === "development",
    );
  });
});
