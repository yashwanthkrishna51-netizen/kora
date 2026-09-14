import { describe, it, expect } from "vitest";
import {
  currentPhase,
  moduleOwner,
  phaseSignedOff,
  implSignoffCounts,
  projectedGoLive,
} from "@/lib/domain/implementation";
import { PHASES } from "@/lib/domain/constants";
import type { Client, Module, Phase, Status } from "@/lib/domain/types";

/**
 * The derivations behind artboards 1e and 1f.
 *
 * None of these has a legacy counterpart, so `tests/golden/parity.test.ts`
 * cannot cover them — they are new answers to questions the old app never
 * asked. What they have in common is that each one substitutes for a column the
 * schema does not have, so the risk is not that they crash but that they are
 * quietly wrong in a way a screenshot cannot show.
 */

const phase = (name: string, p: Partial<Phase> = {}): Phase => ({
  id: `p_${name}`,
  name,
  status: "Not Started" as Status,
  ...p,
});

/** A module holding all nine phases, so the by-name lookup has a full set. */
const mod = (id: string, overrides: Record<string, Partial<Phase>> = {}): Module => ({
  id,
  name: id,
  phases: PHASES.map((n) => phase(n, overrides[n] ?? {})),
});

const client = (...modules: Module[]): Client => ({ id: "c", name: "C", modules });

const withAttachment = {
  updates: [
    {
      id: "a1",
      date: "2026-08-20",
      update: "signed",
      addedBy: "Meera",
      attachment: { storagePath: "x/signoff.pdf", fileName: "signoff.pdf" },
    },
  ],
};

describe("currentPhase", () => {
  it("returns the first phase that is not Completed, in delivery order", () => {
    const m = mod("m1", {
      BPU: { status: "Completed" },
      "BPU Signoff": { status: "Completed" },
      CRP: { status: "In Progress" },
    });
    expect(currentPhase(m)?.name).toBe("CRP");
  });

  it("reads delivery order, not array order", () => {
    // The API returns phases in whatever order the query yields. If this read
    // positionally it would answer "Hypercare" here.
    const m: Module = {
      id: "m2",
      name: "m2",
      phases: [phase("Hypercare"), phase("BPU", { status: "Completed" }), phase("CRP")],
    };
    expect(currentPhase(m)?.name).toBe("CRP");
  });

  it("is null once every phase it holds is Completed", () => {
    const all = Object.fromEntries(PHASES.map((n) => [n, { status: "Completed" as Status }]));
    expect(currentPhase(mod("m3", all))).toBeNull();
  });

  it("survives a module missing rows entirely", () => {
    expect(currentPhase({ id: "m4", name: "m4" })).toBeNull();
  });
});

describe("moduleOwner", () => {
  it("is the current phase's assignee", () => {
    const m = mod("m1", {
      BPU: { status: "Completed", assignee: "Old Hand" },
      "BPU Signoff": { status: "In Progress", assignee: "Kavya" },
    });
    expect(moduleOwner(m)).toBe("Kavya");
  });

  it("falls back to the last assigned phase when the module is finished", () => {
    // A finished module has no current phase, but "nobody" is the wrong answer
    // — somebody delivered it.
    const all = Object.fromEntries(PHASES.map((n) => [n, { status: "Completed" as Status }]));
    const m = mod("m2", { ...all, "Go Live": { status: "Completed", assignee: "Rohan" } });
    expect(moduleOwner(m)).toBe("Rohan");
  });

  it("falls back when the live phase is unassigned", () => {
    const m = mod("m3", {
      BPU: { status: "Completed", assignee: "Kavya" },
      "BPU Signoff": { status: "In Progress" },
    });
    expect(moduleOwner(m)).toBe("Kavya");
  });

  it("is null when nobody is named anywhere", () => {
    expect(moduleOwner(mod("m4"))).toBeNull();
  });
});

describe("phaseSignedOff", () => {
  it("is false for a Completed sign-off phase with no attachment", () => {
    // THE CASE THIS EXISTS FOR. The API cannot create this row — the server
    // runs the same gate — but v1 had no such rule, so migrated data can hold
    // it. A cell that showed a tick here would assert a signature nobody gave.
    expect(phaseSignedOff(phase("UAT Signoff", { status: "Completed" }))).toBe(false);
  });

  it("is true once an update carries the document", () => {
    expect(
      phaseSignedOff(phase("UAT Signoff", { status: "Completed", ...withAttachment })),
    ).toBe(true);
  });

  it("is true for a Completed ordinary phase with no attachment", () => {
    // Only the three sign-off phases are gated; the rest get an advisory.
    expect(phaseSignedOff(phase("CRP", { status: "Completed" }))).toBe(true);
  });

  it("is false for anything not Completed, document or not", () => {
    expect(phaseSignedOff(phase("UAT Signoff", { status: "In Progress", ...withAttachment })))
      .toBe(false);
  });
});

describe("implSignoffCounts", () => {
  it("counts signed-off, total and at-risk-or-delayed across modules", () => {
    const c = client(
      mod("m1", {
        BPU: { status: "Completed" },
        "BPU Signoff": { status: "Completed", ...withAttachment },
        CRP: { status: "At Risk" },
      }),
      mod("m2", { BPU: { status: "Delayed" } }),
    );
    expect(implSignoffCounts(c)).toEqual({
      signedOff: 2,
      total: 18,
      atRiskOrDelayed: 2,
    });
  });

  it("does not count a Completed sign-off phase that lacks its document", () => {
    const c = client(mod("m1", { "UAT Signoff": { status: "Completed" } }));
    expect(implSignoffCounts(c).signedOff).toBe(0);
  });

  it("is all zeroes for a client with no modules", () => {
    expect(implSignoffCounts({ id: "c", name: "C" })).toEqual({
      signedOff: 0,
      total: 0,
      atRiskOrDelayed: 0,
    });
  });
});

describe("projectedGoLive", () => {
  it("is the LATEST Go Live target across modules", () => {
    // The client is live when the last module is, not the first.
    const c = client(
      mod("m1", { "Go Live": { targetDate: "2027-01-30" } }),
      mod("m2", { "Go Live": { targetDate: "2027-03-15" } }),
      mod("m3", { "Go Live": { targetDate: "2026-11-01" } }),
    );
    expect(projectedGoLive(c)).toBe("2027-03-15");
  });

  it("ignores target dates on every other phase", () => {
    const c = client(mod("m1", { Hypercare: { targetDate: "2099-01-01" } }));
    expect(projectedGoLive(c)).toBeNull();
  });

  it("is null when no Go Live phase carries a target date", () => {
    expect(projectedGoLive(client(mod("m1")))).toBeNull();
    expect(projectedGoLive({ id: "c", name: "C" })).toBeNull();
  });
});
