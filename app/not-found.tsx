import Link from "next/link";
import { Compass, LayoutGrid } from "lucide-react";

/**
 * A URL that does not resolve.
 *
 * Reached deliberately as well as accidentally: the phase route calls
 * `notFound()` when the phase name is not one of the fixed nine
 * (`app/(app)/implementation/[clientId]/[moduleId]/[...phase]/page.tsx`), which
 * is the right call for a bad bookmark. Without this file that decision dumped
 * the user onto Next's stock unstyled 404, outside the application shell — so
 * a mistyped URL looked like the app had vanished.
 *
 * Deliberately NOT inside the (app) group: a 404 must render for someone who is
 * not signed in too, and the authenticated layout would redirect them to /login
 * instead of telling them the address was wrong.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-k-surface p-6">
      <div className="k-card w-full max-w-md p-6">
        <Compass size={22} strokeWidth={1.5} aria-hidden className="text-k-mute-2" />
        <h1 className="k-card-title mt-3">That page does not exist</h1>
        <p className="mt-2 text-[12.5px] text-k-ink-3">
          The address may be mistyped, or the record it pointed at may have been
          archived. Archived records are kept, not deleted — an administrator can
          restore one if it went by mistake.
        </p>
        <div className="mt-4">
          <Link href="/dashboard" className="k-btn k-btn-primary k-btn-sm">
            <LayoutGrid size={13} strokeWidth={1.5} aria-hidden />
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
