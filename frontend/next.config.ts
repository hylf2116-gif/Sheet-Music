import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root: a stray package-lock.json in the home folder otherwise makes
  // Next.js pick the wrong root directory.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
