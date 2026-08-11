import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    reactStrictMode: true,
    // Keep dev and production builds isolated so `next build` cleanup cannot
    // invalidate an active `next dev` server's chunk/cache files.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  };
}
