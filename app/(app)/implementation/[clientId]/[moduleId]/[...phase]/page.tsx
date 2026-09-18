import { PHASES } from "@/lib/domain/constants";
import { notFound } from "next/navigation";
import { PhaseDetailView } from "@/components/implementation/phase-view";
import { Hydrate, clientTreeQuery } from "@/lib/query/prefetch";

/**
 * Phase detail.
 *
 * A CATCH-ALL SEGMENT, deliberately, and this is the one route in the app that
 * cannot use a plain dynamic segment. One of the nine fixed phases is named
 * "Data Migration / Production Migration" — it contains a slash, so its URL
 * carries `%2F`:
 *
 *   /implementation/c1/m1/Data%20Migration%20%2F%20Production%20Migration
 *
 * The old app got away with a single segment because it never round-tripped
 * through a server: `pathname.split("/")` treats `%2F` as an opaque character.
 * Next decodes dynamic params before handing them over, and proxies routinely
 * normalise `%2F` to a real `/`, so `[phase]` would see four segments where it
 * expects one and 404. Joining a catch-all back together handles both spellings
 * and keeps the URL byte-identical to the one everyone has bookmarked.
 */
export default async function PhaseDetailPage({
  params,
}: PageProps<"/implementation/[clientId]/[moduleId]/[...phase]">) {
  const { clientId, moduleId, phase } = await params;
  const phaseName = decodeURIComponent(phase.join("/"));

  // Phases are a closed set of nine. Anything else is a bad link, and saying
  // so beats rendering an empty shell for a phase that cannot exist.
  if (!PHASES.includes(phaseName as (typeof PHASES)[number])) notFound();

  return (
    <Hydrate queries={[clientTreeQuery(clientId)]}>
      <PhaseDetailView
        clientId={clientId}
        moduleId={moduleId}
        phaseName={phaseName}
      />
    </Hydrate>
  );
}
