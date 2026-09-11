#!/usr/bin/env node
/**
 * Sends one message through whatever provider the environment configures, and
 * prints what came back.
 *
 * Mail is the one part of this app that cannot be proven by a test suite: it
 * depends on an account, a key and a sender someone else has to approve. This
 * turns "did that work?" into one command, and turns a failure into the
 * provider's own words rather than a silent non-delivery.
 *
 * Usage:  npm run mail:test -- you@example.com
 */

import { existsSync, readFileSync } from "node:fs";

/** Same loader the migration script uses: real environment variables win. */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.trim().replace(/^["']|["']$/g, "");
  }
}

loadDotEnv(".env.local");
loadDotEnv(".env");

const to = process.argv[2];
if (!to || !to.includes("@")) {
  console.error("Usage: npm run mail:test -- you@example.com");
  process.exit(1);
}

// Mirrors env.ts: an explicit webhook wins, and RESEND_API_KEY alone is enough
// because that is what Vercel's Resend integration injects.
const resendKey = process.env.RESEND_API_KEY;
const url =
  process.env.EMAIL_WEBHOOK_URL ??
  (resendKey ? "https://api.resend.com/emails" : undefined);
const token = process.env.EMAIL_WEBHOOK_TOKEN ?? resendKey;
const from = process.env.EMAIL_FROM ?? "Cribbage <onboarding@resend.dev>";

if (!url) {
  console.error(
    "No mail provider is configured. Set RESEND_API_KEY, or point\n" +
      "EMAIL_WEBHOOK_URL at a provider that accepts a JSON POST.\n" +
      "See DEPLOYING.md.",
  );
  process.exit(1);
}

console.log(`→ ${url}`);
console.log(`  from ${from}`);
console.log(`  to   ${to}`);

const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify({
    from,
    to: [to],
    subject: "Cribbage: mail is working",
    text:
      "If you are reading this, sign-in links and turn notifications can " +
      "reach you.\n",
  }),
});

const body = await response.text();
if (!response.ok) {
  console.error(`\n✗ ${response.status}\n${body}`);
  if (response.status === 403 && body.includes("testing emails")) {
    console.error(
      "\nResend's shared onboarding@resend.dev sender may only write to the\n" +
        "address that owns the account. Send to that address, or verify a\n" +
        "domain and set EMAIL_FROM to one of its addresses.",
    );
  }
  process.exit(1);
}

console.log(`\n✓ accepted (${response.status})\n${body}`);
console.log("Check the inbox — and the spam folder, for a first message.");
