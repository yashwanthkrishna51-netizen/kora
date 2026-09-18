import { cache } from "react";

/**
 * Where the milliseconds went, readable from the deployed app.
 *
 * I have measured the wrong machine twice on this problem — a local Postgres
 * three milliseconds away, when production talks to Supabase in Mumbai from
 * whatever region Vercel put the functions in. Guessing again is not an option,
 * and a profiler is not available on someone else's browser. So every server
 * function that awaits something records how long it took, and the page carries
 * the total out with it.
 *
 * A `<meta>` rather than a `Server-Timing` header, because a React Server
 * Component cannot set response headers — by the time a page has rendered the
 * headers are long gone. React 19 hoists metadata tags to `<head>` from
 * anywhere in the tree, so this works wherever it is rendered. API routes get a
 * real `Server-Timing` header instead; see `lib/api/handler.ts`.
 *
 * Read it on the deployed app with:
 *
 *   [...document.querySelectorAll('meta[name=x-kora-timing]')]
 *     .map(m => m.content).sort((a,b) => b.length - a.length)[0]
 *
 * Left on in production deliberately. This is an internal tool, the numbers
 * reveal nothing an authenticated user cannot infer from how long they waited,
 * and diagnosing the next slow screen should not require a redeploy to turn
 * instrumentation on.
 */

/**
 * One marks object per request. `React.cache` is what scopes it — the same
 * mechanism `getCurrentSession` uses — so two people being served at once never
 * see each other's numbers.
 *
 * `cache()` outside a React request scope throws, and these loaders are also
 * called from route handlers, so every access goes through the guard below and
 * degrades to recording nothing rather than to a 500.
 */
const requestMarks = cache((): Record<string, number> => ({}));

function marks(): Record<string, number> | null {
  try {
    return requestMarks();
  } catch {
    return null;
  }
}

/**
 * Run it, and remember what it cost.
 *
 * Deliberately wraps the ASYNC WORK rather than the component that awaits it.
 * `performance.now()` in a component body is an impure call during render, and
 * the purity lint is right to refuse it; a loader is a plain function and the
 * honest place for a clock.
 *
 * Adds rather than assigns, so a label used twice in one request (two clients'
 * trees, say) reports the total spent, which is the number that matters.
 */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const m = marks();
    if (m) m[label] = (m[label] ?? 0) + Math.round(performance.now() - t0);
  }
}

/**
 * Everything recorded so far, as one tag.
 *
 * Rendered from `Hydrate`, which by construction runs after its own prefetch
 * has resolved. A tracker page emits two — one from the layout's boundary and
 * one from the page's — and because the store is shared and only grows, the
 * later tag is a superset of the earlier one. Take the longest; that is what
 * the console snippet above does.
 */
export function TimingMeta() {
  const m = marks();
  const content = m
    ? Object.entries(m)
        .map(([k, v]) => `${k}=${v}`)
        .join(";")
    : "";

  if (!content) return null;
  return <meta name="x-kora-timing" content={content} />;
}
