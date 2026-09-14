import { TrackerFrame } from "@/components/tracker-frame";

export default function ImplementationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TrackerFrame domain="implementation">{children}</TrackerFrame>;
}
