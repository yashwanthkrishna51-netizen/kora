import { TrackerFrame } from "@/components/tracker-frame";

export default function AMSSupportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TrackerFrame domain="ams">{children}</TrackerFrame>;
}
