import { AmsClientView } from "@/components/ams/client-view";
import { Hydrate, clientTreeQuery } from "@/lib/query/prefetch";

export default async function AmsClientPage({
  params,
}: PageProps<"/ams/[clientId]">) {
  const { clientId } = await params;
  return (
    <Hydrate queries={[clientTreeQuery(clientId)]}>
      <AmsClientView clientId={clientId} />
    </Hydrate>
  );
}
