import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root: without this the bundler walks up looking for a
  // lockfile and can settle on the home directory.
  turbopack: { root: import.meta.dirname },
  // Emits .next/standalone: a self-contained server used by the Dockerfile.
  // Platform builders (Vercel, Netlify) ignore it, so it is safe to leave on.
  output: "standalone",
  // The Prisma client ships native query engines; keep it out of the bundler.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;
