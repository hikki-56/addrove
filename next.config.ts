import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server components can import googleapis (server-only)
  serverExternalPackages: ["googleapis", "bcryptjs"],
  allowedDevOrigins: [
    "192.168.1.54",
    "192.168.1.54:3000",
    "192.168.1.44",
    "192.168.1.44:3000",
    "localhost:3000",
    "127.0.0.1:3000",
    "0.0.0.0:3000",
  ],
};

export default nextConfig;
