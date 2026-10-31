import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

/* One page: the journey. The addresses of the earlier pages redirect to it
   (next.config.ts), and a redirect does not belong in a sitemap. Deliberately
   omits `priority` and `changefreq`, both of which Google ignores. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: new URL("/", siteConfig.url).toString(), lastModified: new Date() }];
}
