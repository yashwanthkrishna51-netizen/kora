import { describe, it, expect } from "vitest";
import {
  planDigest, buildDigestItems, buildEmailIndex, routeDigest, SKIP_STATUSES,
} from "@/lib/digest/compute";
import { STATUSES, PHASES } from "@/lib/domain/constants";
import type { Client, Integration, Module, Phase } from "@/lib/domain/types";

/**
 * The digest, computed against a hand-built fixture.
 *
 * No database, no network, no real clock — the routing is where every edge
 * case lives, and it is worth being able to read the whole thing in one file.
 */

const NOW = new Date("2026-09-01T03:30:00Z");
const APP = "https://kora.test";

const USERS = [
  { name: "Kavya", email: "kavya@kognoz.com" },
  { name: "  arjun  ", email: "arjun@kognoz.com" }, // stray whitespace + casing
  { name: "No Email", email: "" },
];

function client(over: Partial<Client> = {}): Client {
  return {
    id: "c1", name: "Aster Retail", description: "", currency: "INR",
    integrations: [], ...over,
  } as Client;
}

const integration = (over: Record<string, unknown> = {}): Integration =>
  ({
    id: "i1", name: "Payroll sync", status: "In Progress",
    description: "", nextAction: "", milestones: [], timeline: [], ...over,
  }) as unknown as Integration;

const moduleWith = (phases: Phase[]): Module =>
  ({ id: "m1", name: "Core HR", phases }) as unknown as Module;

const phase = (over: Record<string, unknown> = {}): Phase =>
  ({
    id: "p1", name: "BPU", status: "In Progress",
    currentActivity: "", nextAction: "", updates: [], ...over,
  }) as unknown as Phase;

/* ================================================================== scope */

describe("what the digest covers", () => {
  it("skips only Completed and Cancelled, whatever else exists", () => {
    // Driven off the STATUSES enum so adding a status fails this test rather
    // than silently widening or narrowing what people are reminded about.
    const clients = STATUSES.map((status, n) =>
      client({
        id: `c${n}`, name: `Client ${n}`,
        integrations: [integration({ id: `i${n}`, status })],
      }),
    );

    const items = buildDigestItems(clients, APP, NOW);
    const covered = STATUSES.filter((s) => !SKIP_STATUSES.has(s));

    expect(items).toHaveLength(covered.length);
    expect(items.map((i) => i.status).sort()).toEqual([...covered].sort());
  });

  it("excludes AMS entirely — work-log entries have no assignee", () => {
    const c = client({
      hasAms: true,
      workLog: [
        { id: "w1", description: "Leave accrual", entryStatus: "Open", hours: 5 },
      ],
    } as Partial<Client>);
    expect(buildDigestItems([c], APP, NOW)).toHaveLength(0);
  });

  it("covers both Integrations and Implementation", () => {
    const c = client({
      integrations: [integration()],
      modules: [moduleWith([phase()])],
    } as Partial<Client>);
    expect(buildDigestItems([c], APP, NOW).map((i) => i.domain).sort())
      .toEqual(["Implementation", "Integrations"]);
  });
});

/* =================================================================== links */

describe("deep links", () => {
  it("builds the integration link", () => {
    const c = client({ integrations: [integration()] });
    expect(buildDigestItems([c], APP, NOW)[0].link)
      .toBe("https://kora.test/integrations/c1/i1");
  });

  it("encodes the phase name, which contains a slash", () => {
    // "Data Migration / Production Migration" is a real member of PHASES and
    // the one link in the app that 404s if left unencoded.
    const slashed = PHASES.find((p) => p.includes("/"))!;
    const c = client({
      modules: [moduleWith([phase({ name: slashed })])],
    } as Partial<Client>);

    const link = buildDigestItems([c], APP, NOW)[0].link;
    expect(link).toBe(
      `https://kora.test/implementation/c1/m1/${encodeURIComponent(slashed)}`,
    );
    expect(link).not.toContain(`/${slashed}`);
  });

  it("does not double up on a trailing slash in the base URL", () => {
    const c = client({ integrations: [integration()] });
    expect(buildDigestItems([c], "https://kora.test/", NOW)[0].link)
      .toBe("https://kora.test/integrations/c1/i1");
  });
});

/* ================================================================ due dates */

describe("due labels", () => {
  const withDue = (dueDate: string) =>
    buildDigestItems(
      [client({ integrations: [integration({ dueDate })] })], APP, NOW,
    )[0];

  it("flags an overdue item", () => {
    const item = withDue("2026-08-30");
    expect(item.dueLabel).toBe("Overdue by 2 days");
    expect(item.overdue).toBe(true);
  });

  it("treats due today as needing attention", () => {
    // days >= 0, deliberately unlike isOverdue's > 0: a reminder that waits
    // until tomorrow to mention today's deadline is useless.
    const item = withDue("2026-09-01");
    expect(item.dueLabel).toBe("Due today");
    expect(item.overdue).toBe(true);
  });

  it("counts down to a future date without flagging it", () => {
    const item = withDue("2026-09-02");
    expect(item.dueLabel).toBe("Due in 1 day");
    expect(item.overdue).toBeUndefined();
  });

  it("says nothing when there is no date", () => {
    const item = buildDigestItems(
      [client({ integrations: [integration()] })], APP, NOW,
    )[0];
    expect(item.dueLabel).toBeUndefined();
  });
});

/* ================================================================= routing */

describe("recipient routing", () => {
  it("tier 1 — matches an assignee case- and whitespace-insensitively", () => {
    const c = client({ integrations: [integration({ assignee: "ARJUN" })] });
    const { emails } = planDigest({
      clients: [c], users: USERS, fallbackEmails: ["ops@kognoz.com"],
      appUrl: APP, now: NOW,
    });
    expect(emails.map((e) => e.to)).toEqual(["arjun@kognoz.com"]);
  });

  it("tier 1 — a user with no email does not absorb the item", () => {
    // Otherwise the item looks routed while actually going nowhere.
    const c = client({ integrations: [integration({ assignee: "No Email" })] });
    const { emails, stats } = planDigest({
      clients: [c], users: USERS, fallbackEmails: ["ops@kognoz.com"],
      appUrl: APP, now: NOW,
    });
    expect(stats.unroutable).toBe(1);
    expect(emails.map((e) => e.to)).toEqual(["ops@kognoz.com"]);
  });

  it("tier 2 — an Implementation phase falls back to the master assignee", () => {
    const c = client({
      masterAssignee: "Kavya",
      modules: [moduleWith([phase({ assignee: "" })])],
    } as Partial<Client>);
    const { emails } = planDigest({
      clients: [c], users: USERS, fallbackEmails: ["ops@kognoz.com"],
      appUrl: APP, now: NOW,
    });
    expect(emails.map((e) => e.to)).toEqual(["kavya@kognoz.com"]);
    expect(emails[0].html).toContain("As master assignee");
  });

  it("tier 2 — an Integration does NOT, since it has no master concept", () => {
    const c = client({
      masterAssignee: "Kavya",
      integrations: [integration({ assignee: "" })],
    });
    const { emails } = planDigest({
      clients: [c], users: USERS, fallbackEmails: ["ops@kognoz.com"],
      appUrl: APP, now: NOW,
    });
    expect(emails.map((e) => e.to)).toEqual(["ops@kognoz.com"]);
  });

  it("tier 2 — the domain guard holds even if an item carries a master", () => {
    // The test above passes whether or not routeDigest checks the domain,
    // because buildDigestItems never puts masterAssignee on an Integration.
    // That makes it a test of the builder, not of the guard. This one feeds
    // routeDigest directly so the guard itself is covered — it is the thing
    // that keeps a future change to the builder from silently rerouting
    // every unassigned integration to the client owner.
    const plan = routeDigest(
      [{
        name: "Payroll", client: "Aster", domain: "Integrations",
        status: "In Progress", link: "https://kora.test/x",
        masterAssignee: "Kavya",
      }],
      buildEmailIndex(USERS),
    );
    expect(plan.stats.unroutable).toBe(1);
    expect(plan.perPerson.size).toBe(0);
  });

  it("tier 3 — unassigned work goes to the fallback list, one mail each", () => {
    const c = client({ integrations: [integration({ assignee: "" })] });
    const { emails } = planDigest({
      clients: [c], users: USERS,
      fallbackEmails: ["ops@kognoz.com", "pmo@kognoz.com"],
      appUrl: APP, now: NOW,
    });
    expect(emails.map((e) => e.to)).toEqual(["ops@kognoz.com", "pmo@kognoz.com"]);
  });

  it("sends nothing to a fallback list that is empty", () => {
    const c = client({ integrations: [integration({ assignee: "" })] });
    const { emails, stats } = planDigest({
      clients: [c], users: USERS, fallbackEmails: [], appUrl: APP, now: NOW,
    });
    expect(emails).toHaveLength(0);
    expect(stats.unroutable).toBe(1);
  });

  it("gives one person one email covering everything they own", () => {
    const c = client({
      masterAssignee: "Kavya",
      integrations: [integration({ assignee: "Kavya" })],
      modules: [moduleWith([phase({ assignee: "" })])],
    } as Partial<Client>);
    const { emails } = planDigest({
      clients: [c], users: USERS, fallbackEmails: [], appUrl: APP, now: NOW,
    });
    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain("Your items");
    expect(emails[0].html).toContain("As master assignee");
  });
});

/* ================================================== the muting asymmetry */

describe("not-started items", () => {
  it("mutes master-assignee not-started work", () => {
    const c = client({
      masterAssignee: "Kavya",
      modules: [moduleWith([phase({ assignee: "", status: "Not Started" })])],
    } as Partial<Client>);
    const { emails } = planDigest({
      clients: [c], users: USERS, fallbackEmails: [], appUrl: APP, now: NOW,
    });
    expect(emails[0].html).toContain("(not started)");
    expect(emails[0].html).toContain("not started yet");
  });

  it("does NOT mute a person's own not-started work", () => {
    // The asymmetry is the point: your own backlog is your job; work that is
    // only yours by oversight is informational.
    const c = client({
      modules: [moduleWith([phase({ assignee: "Kavya", status: "Not Started" })])],
    } as Partial<Client>);
    const { emails } = planDigest({
      clients: [c], users: USERS, fallbackEmails: [], appUrl: APP, now: NOW,
    });
    expect(emails[0].html).toContain("Your items");
    expect(emails[0].html).not.toContain("not started yet");
  });
});

/* ================================================================ rendering */

describe("rendering", () => {
  it("escapes free text — client and item names are whatever someone typed", () => {
    const c = client({
      name: '<script>alert(1)</script>',
      integrations: [integration({
        assignee: "Kavya", name: 'Payroll & "benefits"',
      })],
    });
    const { emails } = planDigest({
      clients: [c], users: USERS, fallbackEmails: [], appUrl: APP, now: NOW,
    });
    expect(emails[0].html).not.toContain("<script>");
    expect(emails[0].html).toContain("&lt;script&gt;");
    expect(emails[0].html).toContain("Payroll &amp; &quot;benefits&quot;");
  });

  it("uses Kognoz brand colours, not the old teal", () => {
    const c = client({ integrations: [integration({ assignee: "Kavya" })] });
    const { emails } = planDigest({
      clients: [c], users: USERS, fallbackEmails: [], appUrl: APP, now: NOW,
    });
    expect(emails[0].html).toContain("#005184");
    expect(emails[0].html).not.toContain("#0e7490");
    // #94a3b8 as body text fails AA on white; the design system forbids it.
    expect(emails[0].html).not.toContain("#94a3b8");
  });

  it("counts items in the intro line, with correct plurals", () => {
    const one = client({ integrations: [integration({ assignee: "Kavya" })] });
    const { emails } = planDigest({
      clients: [one], users: USERS, fallbackEmails: [], appUrl: APP, now: NOW,
    });
    expect(emails[0].html).toContain("1 open item");
    expect(emails[0].html).not.toContain("1 open items");
  });

  it("is deterministic — same fixture, byte-identical output", () => {
    const c = client({
      masterAssignee: "Kavya",
      integrations: [integration({ assignee: "Arjun" })],
      modules: [moduleWith([phase({ assignee: "" })])],
    } as Partial<Client>);
    const run = () => planDigest({
      clients: [c], users: USERS, fallbackEmails: ["ops@kognoz.com"],
      appUrl: APP, now: NOW,
    }).emails;
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

/* =================================================================== index */

describe("email index", () => {
  it("drops users with no name or no email", () => {
    const index = buildEmailIndex([
      { name: "", email: "a@x.com" },
      { name: "Real", email: "" },
      { name: "Good", email: "good@x.com" },
    ]);
    expect([...index.keys()]).toEqual(["good"]);
  });

  it("keeps the first of two users sharing a display name", () => {
    // Name matching is inherently ambiguous; being deterministic about it is
    // the most that can be done without user ids on the assignee field.
    const index = buildEmailIndex([
      { name: "Kavya", email: "first@x.com" },
      { name: "kavya", email: "second@x.com" },
    ]);
    expect(index.get("kavya")?.email).toBe("first@x.com");
  });

  it("counts every item exactly once across the tiers", () => {
    const c = client({
      masterAssignee: "Kavya",
      integrations: [
        integration({ id: "i1", assignee: "Kavya" }),
        integration({ id: "i2", assignee: "" }),
      ],
      modules: [moduleWith([
        phase({ id: "p1", assignee: "" }),
        phase({ id: "p2", name: "CRP", assignee: "Arjun" }),
      ])],
    } as Partial<Client>);

    const items = buildDigestItems([c], APP, NOW);
    const plan = routeDigest(items, buildEmailIndex(USERS));
    expect(plan.stats.total).toBe(4);
    expect(plan.stats.routed + plan.stats.unroutable).toBe(4);
  });
});
