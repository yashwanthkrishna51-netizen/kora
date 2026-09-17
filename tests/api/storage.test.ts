import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Attachment signing.
 *
 * The bucket is private, so a file is reachable only through a short-lived
 * signed URL. The v1 app baked a 4-hour URL into the jsonb, which meant every
 * stored link was dead within a day and only worked because the read path
 * happened to overwrite it. After the migration the database stores only a
 * path, so generating the URL correctly on read is now load-bearing.
 */

const createSignedUrls = vi.fn();
const createSignedUrl = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { from: () => ({ createSignedUrls, createSignedUrl }) },
  }),
}));

const { collectStoragePaths, applySignedUrls, signPaths, signAttachmentsIn } =
  await import("@/lib/storage");

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-for-tests");
  createSignedUrls.mockReset();
  createSignedUrl.mockReset();
});

/** A client tree with attachments at the depths they actually occur. */
const tree = () => ({
  id: "c1",
  integrations: [
    {
      id: "i1",
      timeline: [
        {
          id: "t1",
          update: "signed off",
          attachment: { storagePath: "c1/a.pdf", fileName: "a.pdf" },
        },
        {
          id: "t2",
          // Nested inside edit history — the shape years of records produced.
          edits: [
            { at: "2026-01-01", attachment: { storagePath: "c1/b.png" } },
          ],
        },
      ],
    },
  ],
  modules: [
    {
      id: "m1",
      phases: [
        {
          id: "p1",
          updates: [{ attachment: { storagePath: "c1/c.docx" } }],
        },
      ],
    },
  ],
});

describe("collectStoragePaths", () => {
  it("finds paths at every depth, structurally rather than by schema", () => {
    expect([...collectStoragePaths(tree())].sort()).toEqual([
      "c1/a.pdf",
      "c1/b.png",
      "c1/c.docx",
    ]);
  });

  it("dedupes, so one file is signed once however often it is referenced", () => {
    const dup = [
      { attachment: { storagePath: "x/1.pdf" } },
      { attachment: { storagePath: "x/1.pdf" } },
    ];
    expect(collectStoragePaths(dup).size).toBe(1);
  });

  it("ignores empty and non-string paths", () => {
    const junk = [
      { attachment: { storagePath: "" } },
      { attachment: { storagePath: null } },
      { attachment: { storagePath: 42 } },
      { attachment: {} },
    ];
    expect(collectStoragePaths(junk).size).toBe(0);
  });

  it("survives nulls and primitives without throwing", () => {
    expect(collectStoragePaths(null).size).toBe(0);
    expect(collectStoragePaths([null, 1, "s", undefined]).size).toBe(0);
  });
});

describe("applySignedUrls", () => {
  it("attaches a url beside every storagePath", () => {
    const t = tree();
    applySignedUrls(
      t,
      new Map([
        ["c1/a.pdf", "https://signed/a"],
        ["c1/b.png", "https://signed/b"],
        ["c1/c.docx", "https://signed/c"],
      ]),
    );
    expect(t.integrations[0].timeline[0].attachment).toMatchObject({
      storagePath: "c1/a.pdf",
      url: "https://signed/a",
    });
    // Cast because the two timeline entries are deliberately different
    // shapes — that is the case being covered.
    const edits = (t.integrations[0].timeline[1] as {
      edits: { attachment: Record<string, unknown> }[];
    }).edits;
    expect(edits[0].attachment).toMatchObject({ url: "https://signed/b" });
    expect(t.modules[0].phases[0].updates[0].attachment).toMatchObject({
      url: "https://signed/c",
    });
  });

  it("replaces a stale url rather than leaving the old one", () => {
    // v1 rows still carry expired URLs baked in years ago. Serving one back
    // would render a link that 400s instead of a working download.
    const node = {
      attachment: { storagePath: "c1/a.pdf", url: "https://expired/old" },
    };
    applySignedUrls(node, new Map([["c1/a.pdf", "https://signed/new"]]));
    expect(node.attachment.url).toBe("https://signed/new");
  });

  it("leaves a path unsigned when no URL was produced", () => {
    const node = { attachment: { storagePath: "missing.pdf" } };
    applySignedUrls(node, new Map());
    expect("url" in node.attachment).toBe(false);
  });
});

describe("signPaths", () => {
  it("signs in one bulk call rather than one per file", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "a.pdf", signedUrl: "https://s/a" },
        { path: "b.pdf", signedUrl: "https://s/b" },
      ],
    });
    const urls = await signPaths(["a.pdf", "b.pdf"]);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(urls.get("a.pdf")).toBe("https://s/a");
  });

  it("falls back per-path for anything the bulk call skipped", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: "a.pdf", signedUrl: "https://s/a" }],
    });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://s/b" } });

    const urls = await signPaths(["a.pdf", "b.pdf"]);
    expect(urls.get("a.pdf")).toBe("https://s/a");
    expect(urls.get("b.pdf")).toBe("https://s/b");
    expect(createSignedUrl).toHaveBeenCalledTimes(1); // only the missing one
  });

  it("one unsignable file does not blank out the rest", async () => {
    // The whole point of the fallback: a single bad path must degrade to one
    // missing link, not an empty response for the entire client.
    createSignedUrls.mockRejectedValue(new Error("bucket unavailable"));
    createSignedUrl.mockImplementation(async (p: string) =>
      p === "bad.pdf"
        ? Promise.reject(new Error("not found"))
        : { data: { signedUrl: `https://s/${p}` } },
    );

    const urls = await signPaths(["good.pdf", "bad.pdf"]);
    expect(urls.get("good.pdf")).toBe("https://s/good.pdf");
    expect(urls.has("bad.pdf")).toBe(false);
  });

  it("does not call out at all for an empty set", async () => {
    expect((await signPaths([])).size).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

describe("signAttachmentsIn", () => {
  it("signs a whole payload in one round trip", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "c1/a.pdf", signedUrl: "https://s/a" },
        { path: "c1/b.png", signedUrl: "https://s/b" },
        { path: "c1/c.docx", signedUrl: "https://s/c" },
      ],
    });

    const t = tree();
    const signed = await signAttachmentsIn(t);

    expect(signed).toBe(3);
    // One call for a tree with three attachments at three different depths.
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(t.integrations[0].timeline[0].attachment).toHaveProperty("url");
  });

  it("skips the round trip when there is nothing to sign", async () => {
    expect(await signAttachmentsIn({ id: "c1", integrations: [] })).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
