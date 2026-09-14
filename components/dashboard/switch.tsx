"use client";

import { useEffectiveRole } from "@/lib/store/ui";
import { AdminDashboard } from "./admin-dashboard";
import { MyDashboard } from "./my-dashboard";

/**
 * Picks the dashboard, honouring an admin's view-as preview.
 *
 * The real role arrives from the server; `useEffectiveRole` is the same
 * function the sidebar uses to decide whether to show the Admin link, so an
 * admin previewing as an editor gets the editor's dashboard AND the editor's
 * navigation, rather than a half-preview.
 */
export function DashboardSwitch({
  role,
  name,
}: {
  role: string;
  name: string;
}) {
  const effective = useEffectiveRole(role);
  return effective === "admin" ? <AdminDashboard /> : <MyDashboard name={name} />;
}
