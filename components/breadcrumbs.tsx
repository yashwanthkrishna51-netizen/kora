"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import {
  useCachedClientNames,
  useCachedChildNames,
} from "@/lib/query/hooks";

/**
 * Breadcrumbs.
 *
 * Two presentations in the handoff, and the difference is not decorative: on
 * the tracker screens (1c, 1e) it is a full-width bar with a bottom rule, part
 * of the chrome; on the detail screens (1d, 1f) it is inline text above the
 * title. The bar version anchors a master-detail layout that has no page title
 * of its own.
 */

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({
  crumbs,
  variant = "bar",
}: {
  crumbs: Crumb[];
  variant?: "bar" | "inline";
}) {
  if (!crumbs.length) return null;

  const body = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    return (
      <Fragment key={`${c.label}-${i}`}>
        {i > 0 && (
          <span className="mx-1.5 text-k-mute-2" aria-hidden="true">
            /
          </span>
        )}
        {c.href && !last ? (
          <Link href={c.href} className="hover:text-k-primary">
            {c.label}
          </Link>
        ) : (
          <span className={last ? "font-semibold text-k-ink" : undefined}>
            {c.label}
          </span>
        )}
      </Fragment>
    );
  });

  if (variant === "inline") {
    return (
      <nav aria-label="Breadcrumb" className="mb-3.5 text-[12px] text-k-mute">
        {body}
      </nav>
    );
  }

  // FULL-BLEED, and deliberately NOT centred on the page measure.
  // The only routes that render this bar are the trackers, where it spans the
  // whole content column — above the 268px client rail as well as the page
  // beside it, which is exactly what artboard 1c draws. Centring its contents
  // on the page measure would pull the crumb off the rail's left edge and line
  // it up with nothing.
  return (
    <nav
      aria-label="Breadcrumb"
      className="border-b border-k-line bg-k-paper px-7 py-3.5 text-[12px] text-k-mute"
    >
      {body}
    </nav>
  );
}

const SECTIONS: Record<string, string> = {
  integrations: "Integrations",
  implementation: "Implementation",
  ams: "AMS & Support",
  admin: "Admin",
};

/**
 * Breadcrumbs derived from the URL.
 *
 * Rendered by the app chrome so every tracker screen gets them without opting
 * in — the previous version exported a `Breadcrumbs` component that nothing
 * imported, so the app had none at all.
 *
 * IDS ARE RESOLVED TO NAMES FROM CACHE ONLY. `edge_all_three` is a correct
 * breadcrumb and a useless one; "Aster Retail Group" is what the person came
 * here for. The reason it used to show the id was that resolving one meant
 * fetching the client tree, and putting a request in the chrome on every
 * navigation to obtain a label is a bad trade. That is no longer the choice:
 * the rail has already fetched the client list by the time any tracker screen
 * renders, so the name is sitting in the query cache and reading it is free.
 *
 * When the cache is empty — a hard reload deep into `/admin`, say — the id is
 * still shown. A label is not worth a round trip, and a breadcrumb that
 * flickers from id to name is worse than one that never changes.
 */
export function RouteBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const [section, ...rest] = segments;

  // Hooks must run unconditionally, so the early return lives below them.
  const clientNames = useCachedClientNames();
  const childNames = useCachedChildNames(
    section && section !== "admin" ? rest[0] : undefined,
  );

  // The dashboard is the root; a single crumb saying "Dashboard" above the
  // dashboard is noise.
  if (!segments.length || segments[0] === "dashboard") return null;

  const crumbs: Crumb[] = [
    { label: "Dashboard", href: "/dashboard" },
    { label: SECTIONS[section] ?? section, href: `/${section}` },
  ];

  for (const [i, seg] of rest.entries()) {
    const id = decodeURIComponent(seg);
    crumbs.push({
      // The first segment under a section is a client; deeper ones are its
      // integrations or modules. A phase is neither — it is already its own
      // name in the URL, so the fallback is the right answer there.
      label: (i === 0 ? clientNames.get(id) : childNames.get(id)) ?? id,
      href:
        i < rest.length - 1
          ? `/${section}/${rest.slice(0, i + 1).join("/")}`
          : undefined,
    });
  }

  return <Breadcrumbs crumbs={crumbs} />;
}
