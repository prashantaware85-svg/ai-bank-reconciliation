import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for the minimal production Docker image.
  // Dev (`next dev`) behavior is unchanged.
  output: 'standalone',
};

export default nextConfig;
