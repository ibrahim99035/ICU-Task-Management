import type { NextConfig } from "next";

const isMobile = process.env.NEXT_BUILD_TARGET === "mobile";

const nextConfig: NextConfig = {
  // The web deployment is a normal Next.js full-stack app.
  // The APK build is a static export of the same project; API routes are
  // excluded by accepting only .tsx pages in mobile builds.
  output: isMobile ? "export" : undefined,
  pageExtensions: isMobile ? ["tsx"] : ["tsx", "ts"],
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
