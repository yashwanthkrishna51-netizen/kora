"use client";

import { createContext, useContext, useMemo } from "react";
import { useUsers } from "./hooks";
import { useUi } from "@/lib/store/ui";

/**
 * Who is looking, and what they may do.
 *
 * The role comes from the SERVER, through the authenticated layout, not from a
 * client fetch: the layout has already validated the session against the
 * database on this request, and re-asking over the network would be both slower
 * and less trustworthy.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY. Every route re-checks the role against a
 * fresh database read, so this can only ever hide a control. Hiding it is still
 * worth doing — an editor-only button that 403s when clicked is a worse
 * experience than one that was never offered.
 */

export interface SessionUser {
  name: string;
  username: string;
  role: string;
}

const SessionContext = createContext<SessionUser | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useSession(): SessionUser | null {
  return useContext(SessionContext);
}

/**
 * May this person write?
 *
 * Honours an admin's view-as preview through the same store the sidebar reads,
 * so previewing as a viewer actually hides the write controls rather than
 * leaving them enabled behind a banner claiming otherwise.
 */
export function useCanEdit(): boolean {
  const user = useSession();
  const viewAsRole = useUi((s) => s.viewAsRole);
  // Read-only parallel run: nobody edits here, whatever their role. Routed
  // through this one hook because every write control in the app already asks
  // it — so the controls disappear rather than appearing and then failing,
  // which is what teaches people an app is broken.
  //
  // NOT the security boundary. The boundary is `assertWritable` in withAuth,
  // which does not trust the client; this is the courtesy half, and it is a
  // NEXT_PUBLIC_ variable precisely because it carries no authority.
  if (isReadOnlyBuild()) return false;
  if (!user) return false;
  const effective = user.role === "admin" && viewAsRole ? viewAsRole : user.role;
  return effective === "editor" || effective === "admin";
}

/** Mirrors the server's KORA_READ_ONLY, for hiding controls only. */
export function isReadOnlyBuild(): boolean {
  return process.env.NEXT_PUBLIC_KORA_READ_ONLY === "1";
}

/**
 * Assignee choices, as the data actually stores them.
 *
 * Assignee columns hold typed display NAMES, not user ids — the same fragile
 * key the daily digest routes on. Offering the user list as the options at
 * least stops new rows adding new spellings, but it cannot fix the ones already
 * there: in production two assignee strings are first-name-only ("Himanshu",
 * "Nisha") and match no user, so the work attached to them is invisible on
 * those people's own dashboard.
 *
 * The current value is always included even when it matches nobody, because a
 * `<select>` silently shows the first option when its value is absent — which
 * would make the screen quietly misreport who owns the row.
 */
export function useAssigneeOptions(current?: string | null): string[] {
  const { data } = useUsers();
  // MEMOIZED because the identity is load-bearing downstream: this array is
  // passed as `options` to every assignee select in a table, so a fresh array
  // on every render meant a changed prop on all sixty of them each time
  // anything on the screen re-rendered. `.sort()` on a fresh `.map()` is safe —
  // it is not mutating the query cache — but it was running every render too.
  return useMemo(() => {
    const names = (data ?? []).map((u) => u.name).filter(Boolean).sort();
    const out = ["", ...names];
    if (current && !out.includes(current)) out.push(current);
    return out;
  }, [data, current]);
}
