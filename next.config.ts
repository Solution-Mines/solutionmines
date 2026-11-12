import type { NextConfig } from "next";
import createMDX from "@next/mdx";

/* The site is one page, the voxel journey at /, plus the service detail pages
   restored below. Everything else it used to have -- the work, about and
   contact pages, the legal pages, and the journey's own preview address --
   comes back to it instead of failing. Permanent (308), so search engines
   treat the old addresses as moved here for good and fold whatever they had
   into /. Browsers cache a permanent redirect too: a page brought back at one
   of these addresses needs its line taken out here AND a new address of its
   own -- see RENAMED below. The query string is passed through, so
   /voxel?bench=1 still reaches the bench. */
const RETIRED = [
  "/voxel",
  "/about",
  "/how-we-work",
  "/privacy",
  "/terms",
  "/services",
  // modernization.mdx stays retired -- reviving it is separate, lower-priority
  // work, so this one path still folds into /.
  "/services/modernization",
  "/work/:path*",
  "/contact/:path*",
];

/* The three service pages above came back at different addresses than they
   retired at -- Scout's keyword-exact slugs, not the originals -- so these
   fold into the new page rather than into / like the rest of RETIRED. */
const RENAMED: [string, string][] = [
  ["/services/product-engineering", "/services/custom-software-development"],
  ["/services/integrations", "/services/api-integration"],
  ["/services/automation-data", "/services/workflow-automation"],
];

const nextConfig: NextConfig = {
  // Self-hosted target (plan §6.6): a dependency-traced server bundle that
  // runs with `node server.js` behind nginx.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  images: { formats: ["image/avif", "image/webp"] },
  redirects() {
    return [
      ...RETIRED.map((source) => ({ source, destination: "/", permanent: true })),
      ...RENAMED.map(([source, destination]) => ({ source, destination, permanent: true })),
    ];
  },
};

/* Turbopack cannot serialise plugin *functions* across its worker boundary,
   so remark/rehype plugins must be named as strings here, not imported and
   passed by reference. Passing imported functions is the single most common
   way an MDX setup silently fails to build under Turbopack. */
const withMDX = createMDX({
  options: {
    remarkPlugins: [
      ["remark-frontmatter"],
      ["remark-mdx-frontmatter", { name: "meta" }],
      ["remark-gfm"],
    ],
    rehypePlugins: [
      ["rehype-slug"],
      ["rehype-autolink-headings", { behavior: "wrap" }],
    ],
  },
});

export default withMDX(nextConfig);
