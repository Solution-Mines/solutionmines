import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { getServices, getCaseStudies } from "@/lib/content";

/* Generated from the content layer, so a new case study cannot be published
   without appearing here. Deliberately omits `priority` and `changefreq`,
   both of which Google ignores.

   /contact/received is excluded: it is noindex, and listing a noindex URL in
   a sitemap is a contradictory signal. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url;
  const now = new Date();

  const staticRoutes = [
    "/",
    "/services",
    "/work",
    "/how-we-work",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
  ].map((path) => ({
    url: new URL(path, base).toString(),
    lastModified: now,
  }));

  const serviceRoutes = getServices().map(({ data }) => ({
    url: new URL(`/services/${data.slug}`, base).toString(),
    lastModified: data.updatedAt ? new Date(data.updatedAt) : now,
  }));

  const workRoutes = getCaseStudies().map(({ data }) => ({
    url: new URL(`/work/${data.slug}`, base).toString(),
    lastModified: new Date(data.updatedAt ?? data.publishedAt),
  }));

  return [...staticRoutes, ...serviceRoutes, ...workRoutes];
}
