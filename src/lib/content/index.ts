import { SERVICES, type ServiceEntry } from "./registry";

export type { Service } from "./schemas";
export type { ServiceEntry } from "./registry";

/* ----------------------------------------------------------------------------
   THE SEAM

   No page component, metadata function, sitemap entry or generateStaticParams
   call ever touches an MDX file or the registry directly — they all go through
   the functions below. That single indirection means a future CMS migration,
   or a drop back to typed TS modules, touches this file only.

   Drafts are filtered here, once, rather than in every consumer — which is how
   a draft ends up in a sitemap.
-------------------------------------------------------------------------------*/

const isPublished = (e: ServiceEntry) =>
  process.env.NODE_ENV === "development" || !e.data.draft;

const byOrder = (a: ServiceEntry, b: ServiceEntry) => a.data.order - b.data.order;

export function getServices(): ServiceEntry[] {
  return SERVICES.filter(isPublished).sort(byOrder);
}

export function getServiceBySlug(slug: string): ServiceEntry | null {
  return getServices().find((s) => s.data.slug === slug) ?? null;
}

export function getServiceSlugs(): string[] {
  return getServices().map((s) => s.data.slug);
}

/** Related services, silently dropping any slug that isn't currently wired
 *  into the registry (e.g. modernization, still retired) rather than
 *  producing a broken link. */
export function getRelatedServices(slug: string): ServiceEntry[] {
  const service = getServiceBySlug(slug);
  if (!service) return [];
  return service.data.relatedServices
    .map((s) => getServiceBySlug(s))
    .filter((s): s is ServiceEntry => s !== null);
}
