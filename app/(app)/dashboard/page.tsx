import { getCurrentSession } from "@/lib/auth/current-session";
import { DashboardSwitch } from "@/components/dashboard/switch";
import { Hydrate, clientTreesQuery } from "@/lib/query/prefetch";

/**
 * There are TWO dashboards, and which one you get is not a permissions
 * variation on one screen — an admin sees the portfolio, everyone else sees
 * their own work. The session is read here, on the server, so the name and role
 * come from the database rather than from anything the browser could set.
 */
export default async function DashboardPage() {
  // Free: the layout already resolved this in the same request, and
  // React.cache returns that same promise rather than querying again.
  const session = await getCurrentSession();

  // The layout has already redirected an invalid session; this is belt and
  // braces so the component below can take a non-null user.
  if (!session.valid) return null;

  // The whole portfolio, nested, rendered on the server. It is the heaviest
  // query in the app and it is what every tile on both dashboards reads, so
  // fetching it after hydration meant the landing page of the whole tool
  // showed skeletons for a round trip it did not need to make.
  //
  // Snapshots and capacity weights are deliberately left to the browser: the
  // tiles render without them (`snaps.data ?? []`, and the weights fall back
  // to the documented defaults), they run in parallel with nothing, and both
  // are cached for ten minutes.
  return (
    <Hydrate queries={[clientTreesQuery()]}>
      <DashboardSwitch role={session.user.role} name={session.user.name} />
    </Hydrate>
  );
}
