import type { Metadata } from "next";
import { VoxelView } from "./voxel/VoxelView";
import { StructuredData } from "@/components/StructuredData";
import { graph, organizationNode, websiteNode } from "@/lib/seo/structured-data";
import { buildMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/config/site";

/* The site is the journey: the floating island, the mine inside it, and the
   five stages of the work told on the way through. It is the only page --
   next.config.ts sends the addresses of the earlier pages here.

   The title is written out whole: the root layout's template only reaches
   the segments below it, and this page is in the layout's own. */
export const metadata: Metadata = {
  ...buildMetadata({
    title: siteConfig.tagline,
    description: siteConfig.description,
    path: "/",
  }),
  title: { absolute: `${siteConfig.tagline} | ${siteConfig.name}` },
};

export default function Home() {
  return (
    <>
      <StructuredData data={graph([organizationNode(), websiteNode()])} />
      <VoxelView />
    </>
  );
}
