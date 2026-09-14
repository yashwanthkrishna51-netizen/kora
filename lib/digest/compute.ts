import type { Client, Status } from "@/lib/domain/types";
import { daysDiff } from "@/lib/utils/dates";
import { digestEmailHtml, type DigestItem, type DigestSection } from "@/lib/mail/templates";

/**
 * The daily digest, computed.
 *
 * PURE. Clients, users and a fallback list in; addressed emails out. No
 * database, no network, no clock of its own. That is what makes the routing —
 * which is the part with all the edge cases — testable against a hand-built
 * fixture rather than against a seeded database and a mocked mailer.
 *
 * `lib/digest/run.ts` is the thin impure shell that fetches and sends.
 */

/** Finished work is not a reminder. */
export const SKIP_STATUSES: ReadonlySet<string> = new Set<Status>([
  "Completed",
  "Cancelled",
]);

export interface DigestUser {
  name: string;
  email: string;
}

export interface RoutedItem extends DigestItem {
  /** Display name of whoever the item was matched to, if anyone. */
  assignee?: string;
  /** The client's master assignee, used only as an Implementation fallback. */
  masterAssignee?: string;
}

/**
 * Flattens clients into reminder rows.
 *
 * Integrations and Implementation phases only. AMS is excluded structurally,
 * not by a filter: work-log entries have no assignee field, so there is nobody
 * to remind. That is worth stating because "the digest is missing AMS" looks
 * like a bug until you know.
 */
export function buildDigestItems(
  clients: Client[],
  appUrl: string,
  now: Date = new Date(),
): RoutedItem[] {
  const base = appUrl.replace(/\/+$/, "");
  const items: RoutedItem[] = [];

  for (const c of clients) {
    for (const i of c.integrations ?? []) {
      if (SKIP_STATUSES.has(i.status)) continue;
      items.push({
        name: i.name,
        client: c.name,
        domain: "Integrations",
        status: i.status,
        link: `${base}/integrations/${c.id}/${i.id}`,
        ...dueFields(i.dueDate, now),
        nextAction: i.nextAction || undefined,
        description: i.description || undefined,
        assignee: i.assignee || undefined,
        // Integrations have no master-assignee concept — only Implementation
        // falls back to one.
      });
    }

    for (const m of c.modules ?? []) {
      for (const ph of m.phases ?? []) {
        if (SKIP_STATUSES.has(ph.status)) continue;
        items.push({
          name: `${m.name} — ${ph.name}`,
          client: c.name,
          domain: "Implementation",
          status: ph.status,
          // The phase name is encoded: "Data Migration / Production Migration"
          // contains a slash, and an unencoded one silently becomes a 404.
          link: `${base}/implementation/${c.id}/${m.id}/${encodeURIComponent(ph.name)}`,
          ...dueFields(ph.targetDate, now),
          nextAction: ph.nextAction || undefined,
          description: ph.currentActivity || undefined,
          assignee: ph.assignee || undefined,
          masterAssignee: c.masterAssignee || undefined,
          notStarted: ph.status === "Not Started",
        });
      }
    }
  }

  return items;
}

/**
 * Due-date wording.
 *
 * `overdue` here is `days >= 0` — due TODAY is emphasised, because a reminder
 * that waits until tomorrow to flag today's deadline is useless. Note this is
 * deliberately NOT `isOverdue` from lib/domain/integrations.ts, which uses
 * `> 0` and also excludes Completed. They answer different questions and must
 * not be merged, or the email's emphasis silently changes.
 */
function dueFields(
  due: string | undefined,
  now: Date,
): { dueLabel?: string; overdue?: boolean } {
  if (!due) return {};
  const days = daysDiff(due, now);
  if (days === null) return {};

  if (days > 0) return { dueLabel: `Overdue by ${days} day${days === 1 ? "" : "s"}`, overdue: true };
  if (days === 0) return { dueLabel: "Due today", overdue: true };
  const left = -days;
  return { dueLabel: `Due in ${left} day${left === 1 ? "" : "s"}` };
}

/**
 * Display name → contact, for matching an assignee string to a person.
 *
 * Name-based, which is fragile — it is what the old app did and what the data
 * supports, since assignee fields hold typed names rather than user ids.
 * Trimmed and lowercased so casing and stray spaces do not silently drop
 * somebody's entire digest.
 *
 * Users with no email are excluded: there is nowhere to send, and including
 * them would make an item look routed when it is actually lost.
 */
export function buildEmailIndex(
  users: DigestUser[],
): Map<string, DigestUser> {
  const index = new Map<string, DigestUser>();
  for (const u of users) {
    const key = (u.name ?? "").trim().toLowerCase();
    if (!key || !u.email) continue;
    if (!index.has(key)) index.set(key, u);
  }
  return index;
}

export interface DigestPlan {
  /** email -> what that person receives */
  perPerson: Map<
    string,
    { name: string; own: RoutedItem[]; masterByClient: Map<string, RoutedItem[]> }
  >;
  fallback: RoutedItem[];
  stats: { total: number; routed: number; unroutable: number };
}

/**
 * Three tiers, in order.
 *
 *   1. The item's own assignee resolves to a user with an email.
 *   2. Implementation only: no resolvable assignee, but the client has a
 *      master assignee who resolves.
 *   3. Everything else goes to the configured fallback list, so an unassigned
 *      item is still somebody's problem rather than nobody's.
 */
export function routeDigest(
  items: RoutedItem[],
  index: Map<string, DigestUser>,
): DigestPlan {
  const perPerson: DigestPlan["perPerson"] = new Map();
  const fallback: RoutedItem[] = [];

  const lookup = (name?: string) =>
    name ? index.get(name.trim().toLowerCase()) : undefined;

  const bucketFor = (user: DigestUser) => {
    let entry = perPerson.get(user.email);
    if (!entry) {
      entry = { name: user.name, own: [], masterByClient: new Map() };
      perPerson.set(user.email, entry);
    }
    return entry;
  };

  for (const item of items) {
    const owner = lookup(item.assignee);
    if (owner) {
      bucketFor(owner).own.push(item);
      continue;
    }

    // Tier 2 is Implementation-only by design: an Integration has no master
    // assignee, so there is nothing to fall back to.
    const master =
      item.domain === "Implementation" ? lookup(item.masterAssignee) : undefined;
    if (master) {
      const entry = bucketFor(master);
      const list = entry.masterByClient.get(item.client) ?? [];
      list.push(item);
      entry.masterByClient.set(item.client, list);
      continue;
    }

    fallback.push(item);
  }

  let routed = 0;
  for (const entry of perPerson.values()) {
    routed += entry.own.length;
    for (const list of entry.masterByClient.values()) routed += list.length;
  }

  return {
    perPerson,
    fallback,
    stats: { total: items.length, routed, unroutable: fallback.length },
  };
}

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Renders a plan into addressed emails. */
export function renderDigestPlan(
  plan: DigestPlan,
  fallbackEmails: string[],
): OutboundEmail[] {
  const out: OutboundEmail[] = [];

  for (const [email, entry] of plan.perPerson) {
    const sections: DigestSection[] = [];

    // A person's OWN not-started items are not muted — muting is reserved for
    // work that is somebody else's day job and only theirs by oversight.
    if (entry.own.length) {
      sections.push({ heading: "Your items", items: entry.own });
    }

    let masterTotal = 0;
    for (const [client, list] of entry.masterByClient) {
      const active = list.filter((i) => !i.notStarted);
      const notStarted = list.filter((i) => i.notStarted);
      masterTotal += list.length;
      if (active.length) {
        sections.push({ heading: `As master assignee — ${client}`, items: active });
      }
      if (notStarted.length) {
        sections.push({
          heading: `As master assignee — ${client} (not started)`,
          muted: true,
          items: notStarted,
        });
      }
    }

    if (!sections.length) continue;

    const overdue = entry.own.filter((i) => i.overdue).length;
    const parts = [`You have ${plural(entry.own.length, "open item")}`];
    if (overdue) parts.push(`${overdue} needing attention today or sooner`);
    if (masterTotal) parts.push(`plus ${plural(masterTotal, "item")} on clients you own`);

    out.push({
      to: email,
      subject: "Kora — your daily reminder",
      html: digestEmailHtml({
        greeting: `Hello ${entry.name},`,
        intro: `${parts.join(", ")}.`,
        sections,
      }),
    });
  }

  if (plan.fallback.length && fallbackEmails.length) {
    const active = plan.fallback.filter((i) => !i.notStarted);
    const notStarted = plan.fallback.filter((i) => i.notStarted);
    const sections: DigestSection[] = [];
    if (active.length) sections.push({ heading: "Unassigned — active", items: active });
    if (notStarted.length) {
      sections.push({ heading: "Unassigned — not started", muted: true, items: notStarted });
    }

    const html = digestEmailHtml({
      greeting: "Hello,",
      intro: `${plural(plan.fallback.length, "item")} could not be matched to an assignee.`,
      sections,
    });

    for (const to of fallbackEmails) {
      out.push({ to, subject: "Kora — unassigned items", html });
    }
  }

  return out;
}

/** The whole computation, end to end. */
export function planDigest(input: {
  clients: Client[];
  users: DigestUser[];
  fallbackEmails: string[];
  appUrl: string;
  now?: Date;
}): { emails: OutboundEmail[]; stats: DigestPlan["stats"] } {
  const items = buildDigestItems(input.clients, input.appUrl, input.now);
  const plan = routeDigest(items, buildEmailIndex(input.users));
  return {
    emails: renderDigestPlan(plan, input.fallbackEmails),
    stats: plan.stats,
  };
}
