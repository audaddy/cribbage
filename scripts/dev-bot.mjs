#!/usr/bin/env node
/**
 * Development opponent.
 *
 * Signs in as a throwaway account, accepts an invite, then plays whenever it is
 * its turn — so you can exercise the whole app on your own machine without
 * finding a second human and a second browser profile.
 *
 * Usage:
 *   node scripts/dev-bot.mjs <INVITE_CODE>          # join, then play forever
 *   node scripts/dev-bot.mjs <INVITE_CODE> --once   # join and take one turn
 *
 * Environment:
 *   BOT_EMAIL   account to use          (default bot@example.test)
 *   BASE_URL    server to talk to       (default http://localhost:3000)
 *
 * The bot plays legally but not well: it lays away its two highest cards and
 * always pegs the first legal card. It is a test fixture, not an opponent.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.BOT_EMAIL ?? "bot@example.test";
const [code, ...flags] = process.argv.slice(2);
const once = flags.includes("--once");

if (!code) {
  console.error("Usage: node scripts/dev-bot.mjs <INVITE_CODE> [--once]");
  process.exit(1);
}

// Cache the session between runs so repeated invocations do not burn through
// the magic-link rate limit.
const SESSION_FILE = join(tmpdir(), `cribbage-dev-bot-${Buffer.from(EMAIL).toString("hex")}.txt`);
let cookie = existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, "utf8").trim() : null;

async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    if (pair?.startsWith("cribbage_session=")) cookie = pair;
  }
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, body };
}

async function signIn() {
  if (cookie) {
    const cached = await call("/api/me");
    if (cached.ok) return cached.body;
    cookie = null;
  }

  const requested = await call("/api/auth/request", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL }),
  });
  if (requested.status === 429) {
    throw new Error("Rate limited by the sign-in endpoint. Wait a few minutes.");
  }
  if (!requested.body?.devUrl) {
    throw new Error(
      `No devUrl (status ${requested.status}). Run the dev server with DEV_ECHO_MAGIC_LINK=true.`,
    );
  }

  await call(requested.body.devUrl.replace(BASE, ""));
  const me = await call("/api/me");
  if (!me.ok) throw new Error(`Sign-in failed (status ${me.status}).`);
  if (cookie) writeFileSync(SESSION_FILE, cookie, { mode: 0o600 });
  return me.body;
}

function chooseMove(view) {
  if (view.phase === "discard") {
    // Lay away the two highest cards; keeps low cards for pegging.
    const order = "A23456789TJQK";
    const sorted = [...view.hand].sort(
      (a, b) => order.indexOf(b[0]) - order.indexOf(a[0]),
    );
    return { type: "discard", cards: [sorted[0], sorted[1]] };
  }
  if (view.phase === "pegging") return { type: "play", card: view.legalPlays[0] };
  if (view.phase === "counting") return { type: "count" };
  return null;
}

async function takeTurns(gameId) {
  for (;;) {
    const game = await call(`/api/games/${gameId}`);
    if (!game.ok) throw new Error(`Cannot read game: ${JSON.stringify(game.body)}`);
    const { view, version } = game.body;

    if (view.phase === "complete") {
      console.log(`Game over — ${view.prompt}`);
      return true;
    }
    if (!view.isYourTurn) return false;

    const move = chooseMove(view);
    if (!move) return false;

    const result = await call(`/api/games/${gameId}/move`, {
      method: "POST",
      body: JSON.stringify({ ...move, version }),
    });
    if (!result.ok) {
      console.error(`Move rejected (${result.status}):`, result.body);
      return false;
    }
    const latest = result.body.log.at(-1);
    console.log(`· ${latest?.message ?? move.type}`);
  }
}

async function main() {
  const me = await signIn();
  console.log(`Bot signed in as ${me.displayName} <${me.email}>`);

  const joined = await call("/api/games/join", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (!joined.ok) throw new Error(`Could not join: ${JSON.stringify(joined.body)}`);
  const gameId = joined.body.id;
  console.log(`Joined game ${gameId}\n`);

  if (once) {
    await takeTurns(gameId);
    return;
  }

  console.log("Watching for turns — Ctrl-C to stop.\n");
  for (;;) {
    const finished = await takeTurns(gameId);
    if (finished) return;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
