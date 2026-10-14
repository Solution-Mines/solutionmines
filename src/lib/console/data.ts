import "server-only";
import { getServices, getCaseStudies, clientLabel } from "@/lib/content";
import type { ConsoleData } from "./engine";

/* Flattens the content entries into the plain, serialisable shape the console
   needs. Done at the server boundary so the client component never receives an
   MDX module, and so the content seam stays the only way content is read. */
export function getConsoleData(): ConsoleData {
  return {
    services: getServices().map(({ data }) => ({
      slug: data.slug,
      title: data.title,
      summary: data.summary,
      outcomes: data.outcomes,
      tech: (data.technologies ?? []).map((t) => t.name),
      duration: data.engagement.duration,
      model: data.engagement.model,
    })),
    work: getCaseStudies().map(({ data }) => ({
      slug: data.slug,
      title: data.title,
      summary: data.summary,
      client: clientLabel(data.client),
      tech: data.technologies,
      metrics: (data.metrics ?? []).map((m) => ({ label: m.label, value: m.value })),
      topology: data.diagram,
    })),
  };
}
