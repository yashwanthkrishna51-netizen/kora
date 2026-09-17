import { inIntegrationsTracker } from "./integrations";

/**
 * The three trackers, and who belongs in each.
 *
 * The type used to live in `components/client-rail.tsx`, which was fine while
 * the rail was the only thing that had to know. It is now read by the landing
 * redirect and by the UI store as well, and a store importing a type from a
 * component is backwards — so it lives here, and the rail re-exports it under
 * its old name so nothing else has to move.
 */
export type TrackerDomain = "implementation" | "ams" | "integrations";

/**
 * What a membership test needs to know about a client.
 *
 * STRUCTURAL ON PURPOSE. `ClientSummary` satisfies this without being named
 * here, which keeps `lib/domain` free of an import from `lib/db` — the same
 * reason `inIntegrationsTracker` takes a bare number rather than the row.
 */
export interface TrackerMembership {
  hasImplementation?: boolean;
  hasAms?: boolean;
  counts: { integrations: number };
}

/**
 * Does this client belong in this tracker's list?
 *
 * TWO DIFFERENT RULES, and the difference is the whole reason this is one
 * function rather than three inline checks.
 *
 * Implementation and AMS are OPT-IN domains: a client is in one because
 * somebody put it there, so the flag is the answer and a count is not. Six
 * production clients are in a domain with nothing in it yet, and filtering
 * those on counts drops all six — the exact bug migration 0003 exists to
 * prevent.
 *
 * Integrations has no such flag, so PRESENCE is the only signal there is, and
 * that rule keeps its own named home in `inIntegrationsTracker` alongside the
 * docblock explaining why the two are opposite.
 *
 * The rail, the index and the landing redirect must all agree: if the landing
 * keeps a client the rail drops, the app sends you to a screen the list refuses
 * to show.
 */
export function inTracker(
  domain: TrackerDomain,
  client: TrackerMembership,
): boolean {
  if (domain === "implementation") return client.hasImplementation === true;
  if (domain === "ams") return client.hasAms === true;
  return inIntegrationsTracker(client.counts.integrations);
}

/**
 * Does this client have anything in this tracker yet?
 *
 * NOT A MEMBERSHIP TEST, and must never be used as one — see above. This is
 * only for the landing redirect, which has to pick ONE client to open and
 * should not open an empty screen when a client with work is available.
 * Alphabetically first in the Implementation rail is a client with zero
 * modules; landing there means answering "choose a client" with a blank matrix.
 *
 * The rail still lists them, the index still lists them, and a client you were
 * last in is still reopened even if it is empty. Only the fallback skips them.
 */
export function hasTrackerWork(
  domain: TrackerDomain,
  counts: { integrations: number; modules: number; workLog: number },
): boolean {
  if (domain === "implementation") return counts.modules > 0;
  if (domain === "ams") return counts.workLog > 0;
  return inIntegrationsTracker(counts.integrations);
}

/**
 * Where a client lives inside a tracker.
 *
 * The segment happens to equal the domain name for all three, which is exactly
 * why this exists: that coincidence was written out as a three-branch identity
 * function in `tracker-shell.tsx` and would have been written again in the
 * landing redirect. One of the two would eventually stop matching the other.
 */
export function trackerHref(domain: TrackerDomain, clientId: string): string {
  return `/${domain}/${encodeURIComponent(clientId)}`;
}
