import type { NextConfig } from "next";

// @ts-ignore — next-pwa types may vary by version
const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development", // Don't run SW in dev
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      {
        // Cache the AI-processed pages so they work offline
        urlPattern: /^https?.+\/api\/proxy/,
        handler: "NetworkFirst",
        options: {
          cacheName: "equinet-pages",
          expiration: {
            maxEntries: 20,
            maxAgeSeconds: 60 * 60 * 24, // 24 hours
          },
          networkTimeoutSeconds: 20,
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  // Allow fetching from any external domain in API routes
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);