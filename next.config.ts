import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  // Self-hosted target (plan §6.6): a dependency-traced server bundle that
  // runs with `node server.js` behind nginx.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  images: { formats: ["image/avif", "image/webp"] },
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
