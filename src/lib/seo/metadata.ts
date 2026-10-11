import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

type Args = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
};

/* One place that builds page metadata, so canonical URLs, OG tags and the
   title template can never drift between routes.

   Titles are 50-60 chars INCLUDING the brand suffix, which the root layout's
   template appends — so `title` here is the page part only. */
export function buildMetadata({
  title,
  description,
  path,
  noindex,
  type = "website",
  publishedTime,
  modifiedTime,
}: Args): Metadata {
  const url = new URL(path, siteConfig.url).toString();

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type,
      url,
      siteName: siteConfig.name,
      title,
      description,
      ...(publishedTime ? { publishedTime } : {}),
      ...(modifiedTime ? { modifiedTime } : {}),
    },
    twitter: { card: "summary_large_image", title, description },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  };
}
