import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root: a stray package-lock.json in the home folder otherwise makes
  // Next.js pick the wrong root directory.
  turbopack: {
    root: __dirname,
  },
  // Development: let iPads / phones on the same home network load the page
  // (e.g. http://192.168.0.145:3000). Has no effect on the online (production) site.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*', '*.local'],
};

export default nextConfig;
