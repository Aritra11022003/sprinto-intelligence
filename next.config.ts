import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright is only used inside Trigger.dev workers; never bundle it into Vercel functions.
  serverExternalPackages: ["playwright-core"],
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
