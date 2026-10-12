import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the App Runner Docker image
  output: "standalone",
};

export default nextConfig;
