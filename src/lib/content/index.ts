import { SERVICES, CASE_STUDIES, type ServiceEntry, type CaseStudyEntry } from "./registry";

export type { Service, CaseStudy } from "./schemas";
export type { ServiceEntry, CaseStudyEntry } from "./registry";

/* ----------------------------------------------------------------------------
   THE SEAM

   No page component, metadata function, sitemap entry or generateStaticParams
   call ever touches an MDX file or the registry directly — they all go through
   the functions below.

   That single indirection is the most architecturally important decision in
   the content layer, because it buys three separate escape hatches:

   1. Moving to a headless CMS later is a rewrite of THIS DIRECTORY ONLY. The
      function signatures stay identical, so no page changes.
   2. If the MDX pipeline ever becomes a liability, services can drop back to
      typed TS modules behind the same interface without touching a call site.
   3. A framework migration has a single, well-defined blast radius.

   Drafts are filtered here, once, rather than in every consumer — which is how
   a draft ends up in a sitemap.
-------------------------------------------------------------------------------*/

const isPublished = <T extends { data: { draft: boolean } }>(e: T) =>
  process.env.NODE_ENV === "development" || !e.data.draft;

const byOrder = <T extends { data: { order: number } }>(a: T, b: T) =>
  a.data.order - b.data.order;

/* --- services ------------------------------------------------------------ */

export function getServices(): ServiceEntry[] {
  return SERVICES.filter(isPublished).sort(byOrder);
}

export function getFeaturedServices(): ServiceEntry[] {
  return getServices().filter((s) => s.data.featured);
}

export function getServiceBySlug(slug: string): ServiceEntry | null {
  return getServices().find((s) => s.data.slug === slug) ?? null;
}

export function getServiceSlugs(): string[] {
  return getServices().map((s) => s.data.slug);
}

export function getRelatedServices(slug: string): ServiceEntry[] {
  const service = getServiceBySlug(slug);
  if (!service) return [];
  return service.data.relatedServices
    .map((s) => getServiceBySlug(s))
    .filter((s): s is ServiceEntry => s !== null);
}

/* --- case studies -------------------------------------------------------- */

export function getCaseStudies(): CaseStudyEntry[] {
  return CASE_STUDIES.filter(isPublished).sort(byOrder);
}

export function getFeaturedCaseStudies(limit?: number): CaseStudyEntry[] {
  const featured = getCaseStudies().filter((c) => c.data.featured);
  // Fall back to the ordered list rather than returning nothing, so the
  // homepage never renders an empty proof section because someone forgot a flag.
  const list = featured.length > 0 ? featured : getCaseStudies();
  return typeof limit === "number" ? list.slice(0, limit) : list;
}

export function getCaseStudyBySlug(slug: string): CaseStudyEntry | null {
  return getCaseStudies().find((c) => c.data.slug === slug) ?? null;
}

export function getCaseStudySlugs(): string[] {
  return getCaseStudies().map((c) => c.data.slug);
}

/** Case studies that reference a given service — powers the reciprocal
 *  service <-> work linking loop the SEO strategy depends on. */
export function getCaseStudiesForService(serviceSlug: string): CaseStudyEntry[] {
  return getCaseStudies().filter((c) => c.data.services.includes(serviceSlug));
}

/** The display name for a client, honouring the anonymised flag. Centralised
 *  so no template can accidentally print a name that must not be published. */
export function clientLabel(c: CaseStudyEntry["data"]["client"]): string {
  return c.anonymised ? `${c.industry} company` : c.name;
}
