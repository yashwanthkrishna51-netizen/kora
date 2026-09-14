import type {
  Client,
  Integration,
  Module,
  Phase,
  WorkLogEntry,
  Status,
} from "@/lib/domain/types";
import { PHASES, STATUSES } from "@/lib/domain/constants";

/**
 * Deterministic fixture generator.
 *
 * Uses a seeded PRNG so a failing differential case is reproducible from its
 * seed alone. Values are drawn to deliberately straddle every threshold the
 * RAG rules care about (0/1/7/14 days, empty pools, missing dates), because
 * uniformly random data almost never lands on a boundary.
 */

export function makeRng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

type Rng = () => number;

const pick = <T>(rng: Rng, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)];

/** Dates chosen around the thresholds the rules hinge on. */
const DAY_OFFSETS = [
  -400, -60, -30, -15, -14, -13, -8, -7, -6, -4, -3, -2, -1, 0, 1, 2, 3, 6, 7, 8,
  13, 14, 15, 30, 90,
];

function dateFrom(base: Date, offsetDays: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function maybeDate(rng: Rng, base: Date): string | undefined {
  if (rng() < 0.2) return undefined;
  return dateFrom(base, pick(rng, DAY_OFFSETS));
}

function makeActivity(rng: Rng, base: Date) {
  const n = Math.floor(rng() * 4);
  return Array.from({ length: n }, (_, k) => {
    const off = pick(rng, DAY_OFFSETS);
    const iso = new Date(base);
    iso.setDate(iso.getDate() + off);
    return {
      id: `a${k}`,
      date: iso.toISOString().slice(0, 10),
      // addedAt is sometimes absent, which changes which field implAutoRag reads.
      addedAt: rng() < 0.7 ? iso.toISOString() : undefined,
      update: "note",
      addedBy: "tester",
    };
  });
}

function makeIntegration(rng: Rng, base: Date, i: number): Integration {
  return {
    id: `i${i}`,
    name: `Integration ${i}`,
    status: pick(rng, STATUSES) as Status,
    assignee: rng() < 0.8 ? pick(rng, ["Arjun", "Kavya", "Priya"]) : undefined,
    dueDate: maybeDate(rng, base),
    effortWeight: pick(rng, [0.25, 0.5, 1, 2]),
    timeline: makeActivity(rng, base),
    milestones: [],
  };
}

function makePhase(rng: Rng, base: Date, name: string, i: number): Phase {
  return {
    id: `p${i}`,
    name,
    status: pick(rng, STATUSES) as Status,
    targetDate: maybeDate(rng, base),
    updates: makeActivity(rng, base),
  };
}

function makeModule(rng: Rng, base: Date, i: number): Module {
  // Sometimes a partial phase set, sometimes the full nine.
  const names = rng() < 0.5 ? PHASES : PHASES.slice(0, 1 + Math.floor(rng() * 9));
  return {
    id: `m${i}`,
    name: `Module ${i}`,
    phases: names.map((n, k) => makePhase(rng, base, n, k)),
  };
}

function makeEntry(rng: Rng, base: Date, i: number): WorkLogEntry {
  return {
    id: `w${i}`,
    dateRaised: dateFrom(base, pick(rng, DAY_OFFSETS)),
    dueDate: maybeDate(rng, base),
    description: "work",
    type: pick(rng, ["Bug Fix", "Enhancement", "Support Ticket", "Meeting"]),
    queryLevel: pick(rng, [
      "L1 - Low",
      "L2 - Medium",
      "L3 - High",
      "L4 - Critical",
    ]),
    entryStatus: pick(rng, ["Open", "In Progress", "Closed"] as const),
    ragStatus: rng() < 0.3 ? pick(rng, ["Red", "Amber", "Green"] as const) : undefined,
    hours: pick(rng, [0, 0.5, 1, 2.5, 8, 12.25, 40]),
  };
}

export function makeClient(rng: Rng, base: Date, n: number): Client {
  const inImpl = rng() < 0.7;
  const inAms = rng() < 0.7;

  const client: Client = {
    id: `c${n}`,
    name: `Client ${n}`,
    integrations: Array.from({ length: Math.floor(rng() * 6) }, (_, i) =>
      makeIntegration(rng, base, i),
    ),
    currency: pick(rng, ["INR", "USD"] as const),
  };

  if (inImpl) {
    client.hasImplementation = true;
    client.modules = Array.from({ length: Math.floor(rng() * 4) }, (_, i) =>
      makeModule(rng, base, i),
    );
  }

  if (inAms) {
    client.hasAms = true;
    client.workLog = Array.from({ length: Math.floor(rng() * 8) }, (_, i) =>
      makeEntry(rng, base, i),
    );
    // Straddle the retainer thresholds, including "no pool" and "exhausted".
    client.totalAvailableHours = pick(rng, [
      undefined as unknown as number,
      0,
      10,
      40,
      120,
      500,
    ]);
    client.manDayRate = pick(rng, [
      undefined as unknown as number,
      0,
      8000,
      12500,
    ]);
  }

  return client;
}

export function makeClients(seed: number, count: number, base: Date): Client[] {
  const rng = makeRng(seed);
  return Array.from({ length: count }, (_, i) => makeClient(rng, base, i));
}
