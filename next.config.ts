import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server components can import googleapis (server-only)
  serverExternalPackages: ["googleapis", "bcryptjs"],
};

export default nextConfig;
