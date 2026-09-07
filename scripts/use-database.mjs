#!/usr/bin/env node
/**
 * Switches the Prisma datasource provider.
 *
 * Prisma cannot read the provider from an environment variable, so moving
 * between local SQLite and a hosted Postgres means editing the schema. This
 * does that edit safely, and reminds you what to run next.
 *
 * Usage:  node scripts/use-database.mjs sqlite|postgresql
 */

import { readFileSync, writeFileSync } from "node:fs";

const SUPPORTED = new Set(["sqlite", "postgresql"]);
const target = process.argv[2];

if (!SUPPORTED.has(target)) {
  console.error("Usage: node scripts/use-database.mjs sqlite|postgresql");
  process.exit(1);
}

const path = new URL("../prisma/schema.prisma", import.meta.url);
const schema = readFileSync(path, "utf8");
const updated = schema.replace(
  /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"[^"]+"/,
  `$1"${target}"`,
);

if (updated === schema) {
  console.log(`Provider is already "${target}" — nothing to change.`);
} else {
  writeFileSync(path, updated);
  console.log(`Datasource provider set to "${target}".`);
}

console.log(
  target === "sqlite"
    ? '\nNext: set DATABASE_URL="file:./dev.db" and run `npm run db:push`.'
    : "\nNext: point DATABASE_URL at your Postgres instance, then run\n" +
        "  npx prisma migrate dev --name init     # once, to create the migration\n" +
        "  npx prisma migrate deploy              # on every deploy",
);
