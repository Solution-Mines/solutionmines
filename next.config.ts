import type { NextConfig } from "next";

/* The site is one page, the voxel journey at /. Everything it used to have
   -- the services, the work, the about and contact pages, the legal pages,
   and the journey's own preview address -- comes back to it instead of
   failing. Permanent (308), so search engines treat the old addresses as
   moved here for good and fold whatever they had into /. Browsers cache a
   permanent redirect too: a page brought back at one of these addresses
   needs its line taken out here AND a new address of its own. The query
   string is passed through, so /voxel?bench=1 still reaches the bench. */
const RETIRED = [
  "/voxel",
  "/about",
  "/how-we-work",
  "/privacy",
  "/terms",
  "/services/:path*",
  "/work/:path*",
  "/contact/:path*",
];

const nextConfig: NextConfig = {
  // Self-hosted target (plan §6.6): a dependency-traced server bundle that
  // runs with `node server.js` behind nginx.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  images: { formats: ["image/avif", "image/webp"] },
  redirects() {
    return RETIRED.map((source) => ({ source, destination: "/", permanent: true }));
  },
};

export default nextConfig;
