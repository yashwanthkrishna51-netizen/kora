/**
 * The browser's side of the API contract.
 *
 * Two things this does that a bare `fetch` does not:
 *
 * CREDENTIALS ARE IMPLICIT. The session is an httpOnly cookie on the same
 * origin, so there is no token to attach and nothing for a script to steal —
 * which is the entire reason the old `x-session-token` header is gone.
 *
 * ERRORS CARRY THEIR BODY. The API returns a shaped error (`{error, code,
 * current, ...}`) and the interesting cases are all in it: a 409 carries the
 * fresh row to heal from, a 428 says the precondition was missing, a 429 says
 * when to retry. Throwing a bare `Error("Request failed")` would discard
 * exactly the part the UI needs.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** A save that lost a race. `body.current` holds the winning row. */
  get isConflict() {
    return this.status === 409;
  }

  /** The session is gone — expired, revoked, or signed out elsewhere. */
  get isUnauthenticated() {
    return this.status === 401;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** The OCC token. Sent as If-Match; required by every PATCH and DELETE. */
  ifMatch?: string;
  signal?: AbortSignal;
  /** Recorded on the audit row, so "who changed this and from where" answers. */
  screen?: string;
}

export async function api<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.ifMatch) headers["if-match"] = opts.ifMatch;
  if (opts.screen) headers["x-kora-screen"] = opts.screen;

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
      // Same-origin cookies. Never "include" — that would be the CORS setup we
      // deliberately no longer have.
      credentials: "same-origin",
    });
  } catch (err) {
    // A TRANSPORT FAILURE IS STILL AN ApiError. `fetch` rejects with a bare
    // TypeError when the request never reached the server — offline, DNS,
    // connection refused — and letting that through un-wrapped broke two things
    // at once: the retry predicate in providers.tsx tests
    // `error instanceof ApiError`, so it saw a foreign error and burned its
    // retries; and every screen fell back to "Something went wrong loading
    // this", which is the least useful sentence available.
    //
    // Status 0 is the convention for "no response", and it is below the 500 the
    // retry predicate uses as its threshold, so this is not retried in a loop.
    if ((err as { name?: string })?.name === "AbortError") throw err;
    throw new ApiError(0, "Could not reach the server. Check your connection.");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // A non-JSON body from a route that always returns JSON means something
    // upstream failed — a proxy error page, most likely.
    throw new ApiError(res.status, "The server returned an unexpected response");
  }

  const body = (parsed ?? {}) as Record<string, unknown>;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof body.error === "string" ? body.error : "Something went wrong",
      body,
    );
  }

  return body as T;
}
