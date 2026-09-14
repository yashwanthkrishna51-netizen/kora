import type { NextResponse, NextRequest } from "next/server";
import { json } from "./handler";
import { z } from "zod";
import { badRequest } from "./errors";
import { requireIfMatch } from "./occ";
import { logAudit } from "@/lib/audit";
import type { Ctx } from "./handler";

/**
 * The five steps every write repeats: parse, precondition, mutate, audit,
 * respond.
 *
 * Written once because the two that are easy to skip are the two that matter.
 * A handler missing `requireIfMatch` silently opts that entity out of
 * concurrency control — writes keep succeeding while overwriting each other.
 * A handler missing the audit call leaves an action with no record, which is
 * only noticed when someone asks who changed something.
 */

/** Parses a JSON body, turning a schema failure into a usable message. */
export async function parseBody<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // The path is included because `.strict()` rejections say "unrecognized
    // key" and are meaningless without knowing which one.
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw badRequest(`${issue?.message ?? "Invalid request"}${where}`);
  }
  return parsed.data;
}

// Re-exported so a handler needs one import, not two that differ.
export { json } from "./handler";

/**
 * A create: parse, run, audit, 201.
 */
export async function created<S extends z.ZodType, R, P>(
  ctx: Ctx<P>,
  schema: S,
  action: string,
  entity: string,
  run: (input: z.infer<S>) => Promise<R>,
): Promise<NextResponse> {
  const input = await parseBody(ctx.req, schema);
  const result = await run(input);
  await audit(ctx, action, entity);
  return json(result, 201);
}

/**
 * An update: parse, require If-Match, run, audit.
 *
 * The precondition is read before the body is used, so a request that forgot
 * it fails the same way every time rather than depending on what it contained.
 */
export async function updated<S extends z.ZodType, R, P>(
  ctx: Ctx<P>,
  schema: S,
  action: string,
  entity: string,
  run: (input: z.infer<S>, token: string) => Promise<R>,
): Promise<NextResponse> {
  const token = requireIfMatch(ctx.req);
  const input = await parseBody(ctx.req, schema);
  if (Object.keys(input as object).length === 0) {
    // A no-op patch still bumps updated_at and invalidates the token every
    // other open tab is holding, producing conflicts for a request that
    // changed nothing.
    throw badRequest("Nothing to update");
  }
  const result = await run(input, token);
  await audit(ctx, action, entity);
  return json(result);
}

/** A delete: require If-Match, run, audit. */
export async function removed<R, P>(
  ctx: Ctx<P>,
  action: string,
  entity: string,
  run: (token: string) => Promise<R>,
): Promise<NextResponse> {
  const token = requireIfMatch(ctx.req);
  const result = await run(token);
  await audit(ctx, action, entity);
  return json(result);
}

/** Audit rows record what happened and to what — never the values. */
function audit<P>(ctx: Ctx<P>, action: string, entity: string) {
  return logAudit(ctx.db, {
    actorId: ctx.user.id,
    username: ctx.user.username,
    role: ctx.user.role,
    action,
    entity,
    screen: ctx.req.headers.get("x-kora-screen"),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}
