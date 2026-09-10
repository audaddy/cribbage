import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root: without this the bundler walks up looking for a
  // lockfile and can settle on the home directory.
  turbopack: { root: import.meta.dirname },
  // Emits .next/standalone: a self-contained server, which the Dockerfile
  // copies out. Vercel builds its own output and its post-build step looks for
  // the default trace files, so standalone mode breaks it — hence the opt-out
  // when running on Vercel, which sets VERCEL in the build environment.
  output: process.env.VERCEL ? undefined : "standalone",
  // The Prisma client ships native query engines; keep it out of the bundler.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;
