import type { ComponentType } from "react";
import type { MDXProps } from "mdx/types";
import { serviceSchema, caseStudySchema, type Service, type CaseStudy } from "./schemas";

import ProductEngineering, { meta as productEngineeringMeta } from "@/../content/services/product-engineering.mdx";
import Integrations, { meta as integrationsMeta } from "@/../content/services/integrations.mdx";
import AutomationData, { meta as automationDataMeta } from "@/../content/services/automation-data.mdx";
import Modernization, { meta as modernizationMeta } from "@/../content/services/modernization.mdx";

import PaymentReconciliation, { meta as paymentReconciliationMeta } from "@/../content/work/payment-reconciliation.mdx";
import CodebaseRescue, { meta as codebaseRescueMeta } from "@/../content/work/codebase-rescue.mdx";
import SyncTeardown, { meta as syncTeardownMeta } from "@/../content/work/sync-teardown.mdx";

/* ----------------------------------------------------------------------------
   REGISTRY

   MDX modules are imported EXPLICITLY rather than globbed from disk. Two
   reasons, both deliberate:

   1. Content is bundled at build time, so nothing reads the filesystem at
      request time. That keeps the app compatible with `output: "export"`,
      which is the documented fallback if the server turns out not to run Node.
   2. An explicit list fails loudly when a file is renamed, where a glob would
      silently drop the page from the sitemap.

   The cost is one line per content file. For a marketing site that is a trade
   worth making; if the collection ever grows past a few dozen, this is the
   point to introduce a generated manifest.

   Frontmatter is parsed through Zod HERE, at module load, so malformed content
   fails `next build` rather than rendering a broken page.
-------------------------------------------------------------------------------*/

export type MDXComponent = ComponentType<MDXProps>;

export type ServiceEntry = { data: Service; Body: MDXComponent };
export type CaseStudyEntry = { data: CaseStudy; Body: MDXComponent };

function parse<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { message: string } } },
  meta: unknown,
  file: string,
): T {
  const result = schema.safeParse(meta);
  if (!result.success || !result.data) {
    throw new Error(
      `Invalid frontmatter in ${file}:\n${result.error?.message ?? "unknown error"}`,
    );
  }
  return result.data;
}

const rawServices: ServiceEntry[] = [
  { data: parse<Service>(serviceSchema, productEngineeringMeta, "services/product-engineering.mdx"), Body: ProductEngineering },
  { data: parse<Service>(serviceSchema, integrationsMeta, "services/integrations.mdx"), Body: Integrations },
  { data: parse<Service>(serviceSchema, automationDataMeta, "services/automation-data.mdx"), Body: AutomationData },
  { data: parse<Service>(serviceSchema, modernizationMeta, "services/modernization.mdx"), Body: Modernization },
];

const rawCaseStudies: CaseStudyEntry[] = [
  { data: parse<CaseStudy>(caseStudySchema, paymentReconciliationMeta, "work/payment-reconciliation.mdx"), Body: PaymentReconciliation },
  { data: parse<CaseStudy>(caseStudySchema, codebaseRescueMeta, "work/codebase-rescue.mdx"), Body: CodebaseRescue },
  { data: parse<CaseStudy>(caseStudySchema, syncTeardownMeta, "work/sync-teardown.mdx"), Body: SyncTeardown },
];

/* Referential integrity. A case study pointing at a service that does not
   exist would otherwise produce a dead cross-link and a broken internal
   linking loop — the structure the plan relies on most for SEO. Caught at
   build, not in production. */
const serviceSlugs = new Set(rawServices.map((s) => s.data.slug));

for (const { data } of rawCaseStudies) {
  for (const ref of data.services) {
    if (!serviceSlugs.has(ref)) {
      throw new Error(
        `work/${data.slug}.mdx references unknown service "${ref}". Known services: ${[...serviceSlugs].join(", ")}`,
      );
    }
  }
}

for (const { data } of rawServices) {
  for (const ref of data.relatedServices) {
    if (!serviceSlugs.has(ref)) {
      throw new Error(
        `services/${data.slug}.mdx relatedServices references unknown service "${ref}".`,
      );
    }
    if (ref === data.slug) {
      throw new Error(`services/${data.slug}.mdx lists itself in relatedServices.`);
    }
  }
}

const duplicate = (slugs: string[]) =>
  slugs.find((s, i) => slugs.indexOf(s) !== i);

const dupService = duplicate(rawServices.map((s) => s.data.slug));
if (dupService) throw new Error(`Duplicate service slug: ${dupService}`);

const dupWork = duplicate(rawCaseStudies.map((c) => c.data.slug));
if (dupWork) throw new Error(`Duplicate case study slug: ${dupWork}`);

export const SERVICES = rawServices;
export const CASE_STUDIES = rawCaseStudies;
