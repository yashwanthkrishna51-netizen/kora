import { ImplementationMatrixView } from "@/components/implementation/matrix-view";
import { Hydrate, clientTreeQuery } from "@/lib/query/prefetch";

export default async function ImplementationClientPage({
  params,
}: PageProps<"/implementation/[clientId]">) {
  const { clientId } = await params;
  return (
    <Hydrate queries={[clientTreeQuery(clientId)]}>
      <ImplementationMatrixView clientId={clientId} />
    </Hydrate>
  );
}
