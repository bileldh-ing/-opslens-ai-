import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "bullmq", "ioredis", "@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
};

export default nextConfig;
