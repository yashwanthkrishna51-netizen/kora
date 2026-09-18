import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `/logout` — the typed-URL door.
 *
 * Two things are worth pinning and neither is visible from the outside: that
 * the cookie is actually cleared (a redirect to /login proves nothing — the
 * proxy would bounce you straight back in), and that a GET which mutates is
 * not something any page on the internet can trigger by embedding an image.
 */

const setCalls: { name: string; value: string; maxAge?: number }[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      setCalls.push({ name, value, maxAge: opts?.maxAge });
    },
  }),
}));

const { GET } = await import("@/app/logout/route");

/** `dest` undefined means the header is absent, as some old browsers send it. */
function visit(dest?: string) {
  return new NextRequest("https://kora.test/logout", {
    headers: dest ? { "sec-fetch-dest": dest } : {},
  });
}

beforeEach(() => {
  setCalls.length = 0;
});

describe("GET /logout", () => {
  it("clears the session and sends you to the login screen", async () => {
    const res = await GET(visit("document"));

    // Both cookie names, because production and dev differ and a user can
    // carry either — `clearSessionCookie` already handles that; this asserts
    // the route actually calls it.
    expect(setCalls.map((c) => c.name).sort()).toEqual([
      "__Host-kora_session",
      "kora_session",
    ]);
    expect(setCalls.every((c) => c.value === "" && c.maxAge === 0)).toBe(true);

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("ignores a request that is not a top-level navigation", async () => {
    // `<img src="https://kora/logout">` on any page anywhere would otherwise
    // sign the reader out. Not dangerous, but not theirs to do either.
    const res = await GET(visit("image"));

    expect(setCalls).toEqual([]);
    // Still redirects: a broken image is a better outcome than a hang, and it
    // keeps the response identical whichever way the request arrived.
    expect(res.status).toBe(303);
  });

  it("treats a browser that sends no Sec-Fetch-Dest as a navigation", async () => {
    // Refusing these would break sign-out on that browser rather than protect
    // it — the failure mode of the guard has to be "works", not "cannot".
    await GET(visit());
    expect(setCalls).toHaveLength(2);
  });
});
