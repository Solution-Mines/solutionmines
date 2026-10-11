import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted target (see plan §6.6). Produces a dependency-traced server
  // bundle that runs with `node server.js` behind nginx.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
