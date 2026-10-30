import type { Metadata } from "next";
import { VoxelView } from "./VoxelView";

/* Not public work. A prototype is not a page anyone should reach from a
   search result, and noindex is how you say so — a robots.txt Disallow would
   stop the crawler from ever SEEING the noindex, which is strictly worse.

   This route sits outside the (marketing) group on purpose, so it inherits
   none of the site chrome and cannot affect the homepage, the nav or any
   existing page. */
export const metadata: Metadata = {
  title: "Voxel prototype",
  robots: { index: false, follow: false },
};

export default function VoxelPage() {
  return <VoxelView />;
}
