import { TrackerFrame } from "@/components/tracker-frame";

export default function IntegrationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TrackerFrame domain="integrations">{children}</TrackerFrame>;
}
