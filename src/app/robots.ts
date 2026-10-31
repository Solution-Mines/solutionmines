import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

/* Staging must never be indexed. An indexed staging host creates
   duplicate-content damage that takes months to unwind, and robots.txt alone
   has repeatedly proven insufficient — so this is one of three layers, the
   others being HTTP basic auth and an X-Robots-Tag header at the proxy.

   SITE_ENV is checked rather than NODE_ENV, because staging IS a production
   build and NODE_ENV would read "production" on both.

   Note this file is statically generated, so SITE_ENV is read at BUILD time,
   not at runtime — setting it only when starting the server has no effect.
   Staging and production therefore need separate builds. That is a real
   constraint of self-hosting Next, and the deploy pipeline must set it.

   It is deliberately NOT prefixed NEXT_PUBLIC_: nothing client-side needs it,
   and that prefix would bake it into the browser bundle. */
export default function robots(): MetadataRoute.Robots {
  const isProduction = process.env.SITE_ENV === "production";

  if (!isProduction) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: new URL("/sitemap.xml", siteConfig.url).toString(),
  };
}
