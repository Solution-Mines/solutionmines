import type { NextConfig } from "next";

/* The site is one page, the voxel journey at /. Everything it used to have
   -- the services, the work, the about and contact pages, the legal pages,
   and the journey's own preview address -- comes back to it instead of
   failing. Temporary on purpose: browsers cache a permanent redirect for
   good, and a page brought back later would stay unreachable for anyone who
   had followed one. The query string is passed through, so /voxel?bench=1
   still reaches the bench. */
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
    return RETIRED.map((source) => ({ source, destination: "/", permanent: false }));
  },
};

export default nextConfig;
