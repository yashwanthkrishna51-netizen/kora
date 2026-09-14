import { getCurrentSession } from "@/lib/auth/current-session";
import { Hydrate, clientListQuery, usersQuery } from "@/lib/query/prefetch";
import { TrackerShell } from "@/components/tracker-shell";
import type { Domain } from "@/components/client-rail";

/**
 * The server half of the tracker frame: the rail's data, fetched where the
 * database handle already is.
 *
 * The rail lives in a LAYOUT, so it renders above every tracker page and must
 * be hydrated from a layout too — a boundary inside the page would sit below
 * the component that needs it. Layouts also survive a soft navigation, which is
 * the point: the client list and the user list are fetched once on the first
 * load of a tracker and then never again while you move between clients.
 *
 * `session.valid` is checked rather than assumed. The parent layout redirects
 * an invalid session, but this component's queries would already have run by
 * then, and running a client-list query for someone who is not signed in is
 * the sort of thing that is only ever discovered later. The lookup itself is
 * free — `getCurrentSession` is the same React.cache'd call the parent made.
 */
export async function TrackerFrame({
  domain,
  children,
}: {
  domain: Domain;
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();

  return (
    <Hydrate
      queries={
        session.valid
          ? [clientListQuery(), usersQuery(session.user.role)]
          : []
      }
    >
      <TrackerShell domain={domain}>{children}</TrackerShell>
    </Hydrate>
  );
}
