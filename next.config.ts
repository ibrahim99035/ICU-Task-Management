import type { NextConfig } from "next";

const isMobile = process.env.NEXT_BUILD_TARGET === "mobile";

const nextConfig: NextConfig = {
  // The web deployment is a normal Next.js full-stack app.
  // The APK build is a static export of the same project. The API route is
  // moved aside by scripts/build-mobile.mjs because a static export cannot
  // contain a server route handler.
  output: isMobile ? "export" : undefined,
  trailingSlash: isMobile,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
