import { getDb } from "@/lib/db/client";
import {
  getClientTree,
  getClientTrees,
  listClients,
  type ClientTree,
  type ClientSummary,
} from "@/lib/db/queries/clients";
import { listUsers, type UserOption, type UserAdminView } from "@/lib/db/queries/users";
import { signAttachmentsIn } from "@/lib/storage";
import { timed } from "@/lib/server/timing";

/**
 * The GET bodies of the read routes, as plain functions.
 *
 * SERVER ONLY — this module reaches the database driver. It has no
 * `"use client"` and must never be imported from one; `lib/query/prefetch.tsx`
 * is the only bridge, and it is a server component too.
 *
 * Every one of these returns EXACTLY the JSON body of the route it names, so
 * the route becomes `json(await loadX())` and the server prefetch becomes
 * `loadX().then(pick)` — the same shape, from the same function, by
 * construction. That is the whole point of the file.
 *
 * Before this existed the only way to get a client tree into the browser was
 * to ask the server over HTTP, which on a deployed app meant: browser → Vercel
 * → Supabase, with a session validated again at the Vercel end, AFTER the HTML
 * had already arrived and hydrated. The data is being assembled on the server
 * anyway. Calling these directly from a server component skips the request
 * entirely — not "makes it faster", removes it.
 */

/** GET /api/clients — the list with per-domain counts, for the client rails. */
export async function loadClientList(): Promise<{ clients: ClientSummary[] }> {
  return { clients: await timed("list", () => listClients(getDb())) };
}

/**
 * GET /api/clients?view=tree — every client, fully nested.
 *
 * Attachments are signed once for the whole payload, not per client: a tree
 * can carry dozens and one round trip each to remote storage would dominate.
 */
export async function loadClientTrees(): Promise<{
  clients: ClientTree[];
  signedAttachments: number;
}> {
  const clients = await timed("trees", () => getClientTrees(getDb()));
  const signedAttachments = await timed("storage", () =>
    signAttachmentsIn(clients),
  );
  return { clients, signedAttachments };
}

/**
 * GET /api/clients/[clientId] — one client's tree.
 *
 * `client: null` rather than a throw, so the route can raise its own 404 and
 * the prefetch can decline to cache anything, each saying what it means.
 */
export async function loadClientTree(
  clientId: string,
): Promise<{ client: ClientTree | null }> {
  const client = await timed("tree", () => getClientTree(getDb(), clientId));
  if (!client) return { client: null };
  await timed("storage", () => signAttachmentsIn(client));
  return { client };
}

/**
 * GET /api/users — ROLE-SHAPED, and the role must be the one the database
 * holds now, which is what the caller already has from `getCurrentSession` or
 * from `withAuth`. Typed `string` to match both, and `listUsers` below.
 */
export async function loadUsers(
  role: string,
): Promise<{ users: (UserOption | UserAdminView)[] }> {
  return { users: await timed("users", () => listUsers(getDb(), role)) };
}
