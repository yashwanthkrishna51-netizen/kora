import { describe, it, expect } from "vitest";
import { mapClient } from "@/scripts/migrate/lib/mapping";
import { IssueLog } from "@/scripts/migrate/lib/issues";
import {
  IdCollisionTracker,
  derivePhaseId,
  isSyntheticPhaseId,
  isValidId,
} from "@/scripts/migrate/lib/ids";
import { extractStoragePath } from "@/scripts/migrate/lib/attachments";
import type { Client } from "@/lib/domain/types";

/**
 * Tests for the v1 -> v2 mapping.
 *
 * These are the "data intact" guarantees. Each one encodes a way the migration
 * could silently lose or corrupt a record, so they are written as the failure
 * they prevent, not as coverage of the happy path.
 */

type V1 = Client & { createdAt?: string; updatedAt?: string };

function base(over: Partial<V1> = {}): V1 {
  return {
    id: "c1",
    name: "Aster Retail Group",
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-08-01T09:30:00.000Z",
    integrations: [],
    ...over,
  };
}

const run = (c: V1) => {
  const log = new IssueLog();
  const out = mapClient(c, log);
  return { out, log };
};

describe("domain membership — the v1 null-sentinel", () => {
  it("treats an EMPTY modules array as in-domain, not absent", () => {
    // The failure this prevents: a client that is in the Implementation domain
    // but has no modules yet vanishes from /implementation after cutover.
    const { out } = run(base({ modules: [] }));
    expect(out.client.has_implementation).toBe(true);
    expect(out.modules).toHaveLength(0);
  });

  it("treats an ABSENT modules key as not in the domain", () => {
    const { out } = run(base());
    expect(out.client.has_implementation).toBe(false);
  });

  it("treats null modules as not in the domain", () => {
    const { out } = run(base({ modules: null as never }));
    expect(out.client.has_implementation).toBe(false);
  });

  it("applies the same rule to the AMS work log", () => {
    expect(run(base({ workLog: [] })).out.client.has_ams).toBe(true);
    expect(run(base()).out.client.has_ams).toBe(false);
  });
});

describe("date coercion", () => {
  it("maps empty and missing dates to null without complaint", () => {
    const { out, log } = run(
      base({
        integrations: [
          { id: "i1", name: "A", status: "Not Started", dueDate: "" },
          { id: "i2", name: "B", status: "Not Started" },
        ],
      }),
    );
    expect(out.integrations.map((i) => i.due_date)).toEqual([null, null]);
    expect(log.hasGates).toBe(false);
  });

  it("truncates a full timestamp to its date part", () => {
    const { out } = run(
      base({
        integrations: [
          {
            id: "i1",
            name: "A",
            status: "Not Started",
            dueDate: "2026-09-02T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(out.integrations[0].due_date).toBe("2026-09-02");
  });

  it("GATES on an unparseable date instead of silently nulling it", () => {
    // The old dual-write did `i.dueDate || null`, which sent "TBD" straight
    // into a `date` column and failed the whole client's shadow write.
    const { log } = run(
      base({
        integrations: [
          { id: "i1", name: "A", status: "Not Started", dueDate: "TBD" },
        ],
      }),
    );
    expect(log.hasGates).toBe(true);
    const gate = log.gates.find((g) => g.code === "DATE_UNPARSEABLE");
    expect(gate?.value).toBe("TBD");
    expect(gate?.location).toBe("c1/integrations[0].dueDate");
  });

  it("rejects a well-shaped but impossible calendar date", () => {
    const { log } = run(
      base({
        integrations: [
          { id: "i1", name: "A", status: "Not Started", dueDate: "2026-02-31" },
        ],
      }),
    );
    expect(log.gates.some((g) => g.code === "DATE_UNPARSEABLE")).toBe(true);
  });
});

describe("phase identifiers", () => {
  const withPhases = (phases: unknown[]) =>
    base({
      modules: [{ id: "m1", name: "Core HR", phases: phases as never }],
    });

  it("re-mints the legacy `moduleId::phaseName` synthetic id", () => {
    const { out, log } = run(
      withPhases([{ id: "m1::BPU", name: "BPU", status: "Completed" }]),
    );
    const id = out.phases[0].id;
    expect(isSyntheticPhaseId(id)).toBe(false);
    expect(isValidId(id)).toBe(true);
    expect(id).toBe(derivePhaseId("m1", "BPU"));
    expect(log.counts().ID_REMINTED).toBe(1);
  });

  it("derives an id for a phase that has none", () => {
    const { out, log } = run(withPhases([{ name: "CRP", status: "In Progress" }]));
    expect(isValidId(out.phases[0].id)).toBe(true);
    expect(log.counts().ID_DERIVED).toBe(1);
  });

  it("keeps a valid existing id untouched", () => {
    const { out } = run(
      withPhases([{ id: "ph_keepme", name: "UAT", status: "Not Started" }]),
    );
    expect(out.phases[0].id).toBe("ph_keepme");
  });

  it("gates on a phase name outside the fixed nine", () => {
    const { log } = run(withPhases([{ name: "Discovery", status: "Not Started" }]));
    expect(log.gates.some((g) => g.code === "PHASE_NAME_UNKNOWN")).toBe(true);
  });

  it("gates on a duplicate phase name inside one module", () => {
    // Would otherwise violate uq_phases_v2_module_phasename_active mid-insert.
    const { log } = run(
      withPhases([
        { name: "BPU", status: "Completed" },
        { name: "BPU", status: "In Progress" },
      ]),
    );
    expect(log.gates.some((g) => g.code === "PHASE_NAME_DUP")).toBe(true);
  });
});

describe("AMS date_raised — a NOT NULL column", () => {
  it("uses dateRaised when present", () => {
    const { out } = run(
      base({ workLog: [{ id: "w1", dateRaised: "2026-08-04", hours: 2 }] }),
    );
    expect(out.workLog[0].date_raised).toBe("2026-08-04");
  });

  it("falls back to loggedAt when dateRaised is missing", () => {
    // These rows have been silently failing the old shadow write, because
    // _dualwrite.js passed dateRaised through with no fallback at all.
    const { out, log } = run(
      base({
        workLog: [{ id: "w1", loggedAt: "2026-07-22T11:00:00.000Z", hours: 1 }],
      }),
    );
    expect(out.workLog[0].date_raised).toBe("2026-07-22");
    expect(log.counts().DATERAISED_FALLBACK).toBe(1);
  });

  it("falls back to the client's created_at as a last resort", () => {
    const { out } = run(base({ workLog: [{ id: "w1", hours: 1 }] }));
    expect(out.workLog[0].date_raised).toBe("2026-01-15");
  });

  it("never emits null for date_raised", () => {
    const { out } = run(
      base({ createdAt: undefined, workLog: [{ id: "w1", hours: 1 }] }),
    );
    expect(out.workLog[0].date_raised).toBeTruthy();
  });
});

describe("attachments", () => {
  it("recovers the path from a public URL", () => {
    expect(
      extractStoragePath(
        "https://x.supabase.co/storage/v1/object/public/kora-attachments/1234_ab_spec.pdf",
      ),
    ).toBe("1234_ab_spec.pdf");
  });

  it("recovers the path from an EXPIRED signed URL", () => {
    // Every stored URL in v1 is expired; the path is still recoverable.
    expect(
      extractStoragePath(
        "https://x.supabase.co/storage/v1/object/sign/kora-attachments/99_zz_signoff.pdf?token=deadbeef",
      ),
    ).toBe("99_zz_signoff.pdf");
  });

  it("accepts a bare path and rejects a foreign URL", () => {
    expect(extractStoragePath("77_aa_notes.msg")).toBe("77_aa_notes.msg");
    expect(extractStoragePath("https://example.com/other.pdf")).toBeNull();
  });

  it("strips the dead signed URL and keeps storagePath + metadata", () => {
    const { out, log } = run(
      base({
        integrations: [
          {
            id: "i1",
            name: "A",
            status: "In Progress",
            timeline: [
              {
                id: "t1",
                date: "2026-08-01",
                update: "signed off",
                addedBy: "Meera",
                attachment: {
                  url: "https://x.supabase.co/storage/v1/object/sign/kora-attachments/1_a_signoff.pdf?token=zzz",
                  fileName: "signoff.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 1024,
                } as never,
              },
            ],
          },
        ],
      }),
    );

    const att = (out.integrations[0].activity_log[0] as Record<string, never>)
      .attachment as unknown as Record<string, unknown>;

    expect(att.storagePath).toBe("1_a_signoff.pdf");
    expect(att.url).toBeUndefined();
    expect(att.fileName).toBe("signoff.pdf");
    expect(att.sizeBytes).toBe(1024);
    expect(log.counts().ATTACH_URL_STRIPPED).toBe(1);
  });

  it("keeps an unresolvable attachment verbatim and warns", () => {
    const { out, log } = run(
      base({
        integrations: [
          {
            id: "i1",
            name: "A",
            status: "In Progress",
            timeline: [
              {
                id: "t1",
                date: "2026-08-01",
                update: "x",
                addedBy: "M",
                attachment: { url: "https://elsewhere.example/f.pdf" } as never,
              },
            ],
          },
        ],
      }),
    );
    const att = (out.integrations[0].activity_log[0] as Record<string, never>)
      .attachment as unknown as Record<string, unknown>;
    expect(att.url).toBe("https://elsewhere.example/f.pdf");
    expect(log.warnings.some((w) => w.code === "ATTACH_NO_PATH")).toBe(true);
  });
});

describe("timestamps are preserved, never stamped with now()", () => {
  it("carries the client's own created_at and updated_at through", () => {
    const { out } = run(base());
    expect(out.client.created_at).toBe("2026-01-15T10:00:00.000Z");
    expect(out.client.updated_at).toBe("2026-08-01T09:30:00.000Z");
  });

  it("uses the integration's createdAt, inheriting the client's when absent", () => {
    const { out } = run(
      base({
        integrations: [
          {
            id: "i1",
            name: "A",
            status: "Not Started",
            createdAt: "2026-03-02T08:00:00.000Z",
          },
          { id: "i2", name: "B", status: "Not Started" },
        ],
      }),
    );
    expect(out.integrations[0].created_at).toBe("2026-03-02T08:00:00.000Z");
    expect(out.integrations[1].created_at).toBe("2026-01-15T10:00:00.000Z");
  });

  it("accepts _v as the updated_at source", () => {
    const c = base({ updatedAt: undefined });
    (c as { _v?: string })._v = "2026-08-20T12:00:00.000Z";
    expect(run(c).out.client.updated_at).toBe("2026-08-20T12:00:00.000Z");
  });
});

describe("id collisions across clients", () => {
  it("flags the same integration id reused by two clients", () => {
    // v1 ids only had to be unique within one array; v2 makes them global PKs,
    // so a collision would have one client's row overwrite another's.
    const log = new IssueLog();
    const tracker = new IdCollisionTracker("integrations_v2");
    const shared = { id: "dup1", name: "X", status: "Not Started" as const };

    mapClient(base({ id: "cA", integrations: [shared] }), log, {
      integrations: tracker,
    });
    mapClient(base({ id: "cB", integrations: [shared] }), log, {
      integrations: tracker,
    });

    expect(log.gates.some((g) => g.code === "ID_COLLISION")).toBe(true);
  });
});

describe("required text", () => {
  it("gates on an empty client name (NOT NULL in v2)", () => {
    const { log } = run(base({ name: "   " }));
    expect(log.gates.some((g) => g.code === "NAME_EMPTY")).toBe(true);
  });
});

describe("idempotency", () => {
  it("produces identical output when run twice — the basis of re-runnability", () => {
    const build = (): V1 =>
      base({
        modules: [
          {
            id: "m1",
            name: "Core HR",
            phases: [
              { id: "m1::BPU", name: "BPU", status: "Completed" } as never,
              { name: "CRP", status: "In Progress" } as never,
            ],
          },
        ],
        workLog: [{ id: "w1", hours: 3 }],
        integrations: [{ name: "No id here", status: "Not Started" } as never],
      });

    const a = mapClient(build(), new IssueLog());
    const b = mapClient(build(), new IssueLog());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("phase id derivation is pinned", () => {
  /**
   * These three ids are real rows from production phases_v2, captured with
   * their module_id and phase_name. All 702 live phase ids came out of this
   * function, and phase URLs are built from them, so the inputs, their order
   * and the separator are now part of the stored data — not an implementation
   * detail. Anything that changes the output orphans every phase.
   *
   * The separator in particular was a raw NUL byte in the source, invisible in
   * an editor and silently deletable. This is what would catch that.
   */
  const PRODUCTION_PHASES: [string, string, string][] = [
    ["mrm24wmluw5i", "Hypercare", "ph_00e4bb9520a938ec3f2a9a8c"],
    ["ms32l7bxuwky", "UAT Signoff", "ph_00f0eecf9f39704c32cce54b"],
    ["mrm0x66e50a7", "CRP", "ph_01553d5b52986ac1a5653ab2"],
  ];

  it("reproduces ids stored in production", () => {
    for (const [moduleId, phaseName, expected] of PRODUCTION_PHASES) {
      expect(derivePhaseId(moduleId, phaseName)).toBe(expected);
    }
  });

  it("separates its inputs, so a shifted boundary cannot collide", () => {
    // Without a separator, ("ab","c") and ("a","bc") hash identically and two
    // different phases collapse onto one primary key.
    expect(derivePhaseId("ab", "c")).not.toBe(derivePhaseId("a", "bc"));
  });

  it("is stable across calls", () => {
    expect(derivePhaseId("md_x", "Go Live")).toBe(derivePhaseId("md_x", "Go Live"));
  });
});
