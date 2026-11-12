import type { ComponentType } from "react";
import type { MDXProps } from "mdx/types";
import { serviceSchema, type Service } from "./schemas";

import CustomSoftwareDevelopment, { meta as customSoftwareDevelopmentMeta } from "@/../content/services/custom-software-development.mdx";
import ApiIntegration, { meta as apiIntegrationMeta } from "@/../content/services/api-integration.mdx";
import WorkflowAutomation, { meta as workflowAutomationMeta } from "@/../content/services/workflow-automation.mdx";

/* ----------------------------------------------------------------------------
   REGISTRY

   MDX modules are imported EXPLICITLY rather than globbed from disk. Two
   reasons, both deliberate:

   1. Content is bundled at build time, so nothing reads the filesystem at
      request time. That keeps the app compatible with `output: "export"`,
      which is the documented fallback if the server turns out not to run Node.
   2. An explicit list fails loudly when a file is renamed, where a glob would
      silently drop the page from the sitemap.

   Frontmatter is parsed through Zod HERE, at module load, so malformed content
   fails `next build` rather than rendering a broken page.

   Only three of the original four services (custom-software-development,
   api-integration, workflow-automation) are wired in. modernization.mdx stays
   retired — reviving it is a separate, lower-priority piece of work — so
   relatedServices entries that point at it are filtered out by
   getRelatedServices() in ./index.ts rather than producing a broken link.
-------------------------------------------------------------------------------*/

export type MDXComponent = ComponentType<MDXProps>;

export type ServiceEntry = { data: Service; Body: MDXComponent };

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
  { data: parse<Service>(serviceSchema, customSoftwareDevelopmentMeta, "services/custom-software-development.mdx"), Body: CustomSoftwareDevelopment },
  { data: parse<Service>(serviceSchema, apiIntegrationMeta, "services/api-integration.mdx"), Body: ApiIntegration },
  { data: parse<Service>(serviceSchema, workflowAutomationMeta, "services/workflow-automation.mdx"), Body: WorkflowAutomation },
];

for (const { data } of rawServices) {
  for (const ref of data.relatedServices) {
    if (ref === data.slug) {
      throw new Error(`services/${data.slug}.mdx lists itself in relatedServices.`);
    }
  }
}

const duplicate = (slugs: string[]) =>
  slugs.find((s, i) => slugs.indexOf(s) !== i);

const dupService = duplicate(rawServices.map((s) => s.data.slug));
if (dupService) throw new Error(`Duplicate service slug: ${dupService}`);

export const SERVICES = rawServices;
