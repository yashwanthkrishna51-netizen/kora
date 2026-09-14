import { IntegrationDetailView } from "@/components/integrations/detail-view";
import { Hydrate, clientTreeQuery } from "@/lib/query/prefetch";

export default async function IntegrationDetailPage({
  params,
}: PageProps<"/integrations/[clientId]/[integId]">) {
  const { clientId, integId } = await params;
  return (
    <Hydrate queries={[clientTreeQuery(clientId)]}>
      <IntegrationDetailView clientId={clientId} integId={integId} />
    </Hydrate>
  );
}
