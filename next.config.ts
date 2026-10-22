import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };
import { securityHeaders } from "./src/lib/security-headers";

const dev = process.env.NODE_ENV !== "production";
const https = (process.env.APP_URL ?? "").startsWith("https://");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  serverExternalPackages: ["pg", "bullmq", "ioredis", "@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders({ dev, https }) },
      {
        // The service worker must bypass the HTTP cache, or updates stall.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
