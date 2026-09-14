import { IntegrationsClientView } from "@/components/integrations/client-view";
import { Hydrate, clientTreeQuery } from "@/lib/query/prefetch";

export default async function IntegrationsClientPage({
  params,
}: PageProps<"/integrations/[clientId]">) {
  const { clientId } = await params;
  return (
    <Hydrate queries={[clientTreeQuery(clientId)]}>
      <IntegrationsClientView clientId={clientId} />
    </Hydrate>
  );
}
