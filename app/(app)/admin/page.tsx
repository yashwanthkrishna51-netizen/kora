import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/current-session";
import { loadUsers } from "@/lib/server/loaders";
import {
  Hydrate,
  clientListQuery,
  resolved,
  usersQuery,
} from "@/lib/query/prefetch";
import { AdminScreen } from "@/components/admin/admin-screen";

/**
 * Admin. Gated HERE, on the server, not by hiding the sidebar link.
 *
 * The link is hidden for non-admins (components/sidebar.tsx), but a hidden
 * link is not a permission — anyone who types the URL arrives.
 *
 * The role comes from validateSession, which reads it fresh from the database
 * rather than from the token, so a demotion takes effect immediately. Note this
 * uses the REAL role: an admin previewing as a viewer keeps the admin screen
 * reachable, because view-as is a preview of what others see, not a way to
 * lock yourself out of the tool you are previewing from.
 */
export default async function AdminPage() {
  // Shared with the layout's lookup for this request; the ordering hazard this
  // used to guard now lives in current-session.ts.
  const session = await getCurrentSession();
  if (!session.valid) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  // ONE query for two purposes. This page has always read the user list for
  // its heading count; the table below then asked for the same list again over
  // HTTP after hydrating. `resolved` hands the rows it already has to the
  // client cache under the table's own key, so the second request disappears
  // without the count needing its own query.
  const { users } = await loadUsers(session.user.role);

  return (
    <Hydrate queries={[resolved(usersQuery(session.user.role), users), clientListQuery()]}>
      <AdminScreen userCount={users.length} />
    </Hydrate>
  );
}
