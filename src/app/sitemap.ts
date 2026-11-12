import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { getServices } from "@/lib/content";

/* The journey at /, plus the restored service detail pages. The addresses of
   everything else still retired redirect instead (next.config.ts), and a
   redirect does not belong in a sitemap. Deliberately omits `priority` and
   `changefreq`, both of which Google ignores. */
export default function sitemap(): MetadataRoute.Sitemap {
  const home = { url: new URL("/", siteConfig.url).toString(), lastModified: new Date() };

  const services = getServices().map((s) => ({
    url: new URL(`/services/${s.data.slug}`, siteConfig.url).toString(),
    lastModified: s.data.updatedAt ? new Date(s.data.updatedAt) : new Date(),
  }));

  return [home, ...services];
}
