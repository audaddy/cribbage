#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` over a direct (unpooled) connection.
 *
 * Migrations take advisory locks and run DDL inside transactions, and neither
 * survives a transaction-mode pooler — so they must not use the pooled URL the
 * application runs on.
 *
 * Rather than require a second hand-copied connection string, DIRECT_URL is
 * derived from DATABASE_URL when it is not set: Neon's pooled host is the
 * direct host with `-pooler` inserted, so removing it gives the direct
 * endpoint. On a database with no pooler in front the replacement is a no-op
 * and the two strings are identical, which is also correct.
 *
 * Setting DIRECT_URL explicitly still wins, for anyone whose provider does not
 * follow that convention.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * Prisma reads .env itself, but this script needs DATABASE_URL before it hands
 * over — so load the same file here. Real environment variables win, which is
 * how dotenv behaves and what production relies on.
 */
function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.trim().replace(/^["']|["']$/g, "");
  }
}

loadDotEnv();

const pooled = process.env.DATABASE_URL;

if (!pooled) {
  console.error("DATABASE_URL is not set — nothing to migrate against.");
  process.exit(1);
}

if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = pooled.replace("-pooler", "");
  const derived = process.env.DIRECT_URL !== pooled;
  console.log(
    derived
      ? "DIRECT_URL not set; derived the unpooled endpoint from DATABASE_URL."
      : "DIRECT_URL not set; DATABASE_URL has no pooler, using it directly.",
  );
}

const result = spawnSync("prisma", ["migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
