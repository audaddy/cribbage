#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Signs two players in over the real magic-link flow, opens a game, accepts the
 * invite, then plays hands until someone reaches 121 — driving everything
 * through the HTTP API exactly as a browser would. Also asserts that neither
 * player's response ever contains the other's hidden cards.
 *
 * Usage:  node scripts/smoke.mjs [baseUrl]
 * Requires the dev server to be running with DEV_ECHO_MAGIC_LINK=true.
 */

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

class Player {
  constructor(email) {
    this.email = email;
    this.cookie = null;
  }

  async fetch(path, init = {}) {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const raw of setCookie) {
      const [pair] = raw.split(";");
      if (pair?.startsWith("cribbage_session=")) this.cookie = pair;
    }
    return response;
  }

  async json(path, init) {
    const response = await this.fetch(path, init);
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!response.ok) {
      throw new Error(`${init?.method ?? "GET"} ${path} → ${response.status}: ${text}`);
    }
    return body;
  }

  async signIn() {
    const requested = await this.json("/api/auth/request", {
      method: "POST",
      body: JSON.stringify({ email: this.email }),
    });
    if (!requested.devUrl) {
      throw new Error("No devUrl returned — set DEV_ECHO_MAGIC_LINK=true.");
    }
    const callback = await this.fetch(requested.devUrl.replace(BASE, ""));
    if (callback.status !== 307 && callback.status !== 302) {
      throw new Error(`Magic link callback returned ${callback.status}`);
    }
    const me = await this.json("/api/me");
    this.name = me.displayName;
    return me;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

/** Picks a legal move for whoever is to act. */
function chooseMove(view) {
  switch (view.phase) {
    case "discard":
      return { type: "discard", cards: [view.hand[4], view.hand[5]] };
    case "pegging":
      assert(view.legalPlays.length > 0, "a player to act always has a legal play");
      return { type: "play", card: view.legalPlays[0] };
    case "counting":
      return { type: "count" };
    default:
      throw new Error(`No move for phase ${view.phase}`);
  }
}

/** The opponent's cards must never appear in a player's payload. */
function assertNoLeak(detail, opponentHand) {
  if (!opponentHand || detail.view.opponentHand) return; // legitimately revealed
  const blob = JSON.stringify(detail.view);
  for (const card of opponentHand) {
    // A card the opponent has already played is public; only unplayed ones leak.
    const played = detail.view.play.history.some((p) => p.card === card);
    if (!played) {
      assert(!blob.includes(`"${card}"`), `hidden card ${card} leaked into the view`);
    }
  }
}

/**
 * Plays a whole game against the computer the way the browser does: the human
 * moves when it is their turn, and nudges the bot endpoint when it is not.
 */
async function playTheComputer(player, spectator) {
  const created = await player.json("/api/games/cpu", { method: "POST" });
  let detail = await player.json(`/api/games/${created.id}`);
  assert(detail.opponentIsBot, "the client is told it faces the computer");
  assert(detail.status === "active", "a computer game starts already seated");

  const outsider = await spectator.fetch(`/api/games/${created.id}/bot`, {
    method: "POST",
  });
  assert(outsider.status === 403, `only players may nudge the bot (got ${outsider.status})`);

  let moves = 0;
  while (detail.view.phase !== "complete") {
    if (moves++ > 4000) throw new Error("computer game did not finish");
    detail = await player.json(`/api/games/${created.id}`);
    if (detail.view.phase === "complete") break;

    if (detail.view.pending.includes(detail.view.you)) {
      detail = await player.json(`/api/games/${created.id}/move`, {
        method: "POST",
        body: JSON.stringify({
          ...chooseMove(detail.view),
          version: detail.version,
        }),
      });
    } else {
      const before = detail.version;
      detail = await player.json(`/api/games/${created.id}/bot`, { method: "POST" });
      assert(detail.version > before, "each nudge advances the computer exactly once");
    }
  }
  return { detail, moves };
}

async function main() {
  const stamp = Date.now();
  const alice = new Player(`alice.${stamp}@example.test`);
  const bob = new Player(`bob.${stamp}@example.test`);

  console.log("→ signing both players in via magic link");
  await alice.signIn();
  await bob.signIn();
  console.log(`  ${alice.name} <${alice.email}>`);
  console.log(`  ${bob.name} <${bob.email}>`);

  console.log("→ creating a game and sharing the invite");
  const created = await alice.json("/api/games", { method: "POST" });
  assert(created.inviteUrl.includes(created.inviteCode), "invite url carries the code");

  const lobbyBefore = await alice.json("/api/games");
  assert(lobbyBefore.games.length === 1, "the game shows up in the lobby");
  assert(
    lobbyBefore.games[0].status === "awaiting_opponent",
    "a new game waits for an opponent",
  );

  console.log("→ turn notifications are wired");
  const anonPush = await fetch(`${BASE}/api/push/subscribe`);
  assert(anonPush.status === 401, `push keys need a session (got ${anonPush.status})`);
  const pushKeys = await alice.json("/api/push/subscribe");
  assert(
    typeof pushKeys.publicKey === "string" || pushKeys.publicKey === null,
    "push endpoint reports whether notifications are available",
  );

  console.log("→ the sign-in page offers a way in without email");
  const loginPage = await (await fetch(`${BASE}/login`)).text();
  assert(
    loginPage.includes("Start playing without an account"),
    "sign-in page offers the guest route",
  );

  console.log("→ the invite link works for a signed-out visitor");
  const anonymous = await fetch(`${BASE}/join/${created.inviteCode}`, {
    redirect: "manual",
  });
  assert(
    anonymous.status === 200,
    `invite page renders without a session (got ${anonymous.status})`,
  );
  const invitePage = await anonymous.text();
  assert(
    invitePage.includes("Join the game"),
    "invite page offers to seat the visitor",
  );
  assert(
    !invitePage.includes("Email me a sign-in link"),
    "invite page does not force a sign-in first",
  );

  console.log("→ opponent accepts");
  const joined = await bob.json("/api/games/join", {
    method: "POST",
    body: JSON.stringify({ code: created.inviteCode }),
  });
  assert(joined.id === created.id, "both players are in the same game");

  console.log("→ table talk crosses the board");
  const beforeTalk = await alice.json(`/api/games/${created.id}`);
  const said = await alice.json(`/api/games/${created.id}/react`, {
    method: "POST",
    body: JSON.stringify({ key: "nineteen" }),
  });
  assert(said.reactions.length === 1, "the reaction is recorded");
  assert(said.reactions[0].seat === 0, "it is attributed to the speaker");
  // The point of keeping reactions out of the game: they cannot lose a race
  // with a move, because they are not a move.
  assert(
    said.version === beforeTalk.version,
    "saying something does not bump the version",
  );

  const heard = await bob.json(`/api/games/${created.id}`);
  assert(heard.reactions.length === 1, "the other player hears it");
  assert(heard.reactions[0].key === "nineteen", "with the line intact");

  const nonsense = await alice.fetch(`/api/games/${created.id}/react`, {
    method: "POST",
    body: JSON.stringify({ key: "'; drop table" }),
  });
  assert(nonsense.status === 403, `only known lines are accepted (got ${nonsense.status})`);

  console.log("→ a third party cannot see the game");
  const carol = new Player(`carol.${stamp}@example.test`);
  await carol.signIn();
  const forbidden = await carol.fetch(`/api/games/${created.id}`);
  assert(forbidden.status === 403, `spectators are refused (got ${forbidden.status})`);

  console.log("→ playing it out");
  const players = { 0: alice, 1: bob };
  let moves = 0;
  let detail = await alice.json(`/api/games/${created.id}`);

  while (detail.view.phase !== "complete") {
    if (moves++ > 4000) throw new Error("game did not finish");

    const seat = detail.view.pending[0];
    assert(seat !== undefined, "somebody must always be able to act");
    const actor = players[seat];

    const actorDetail = await actor.json(`/api/games/${created.id}`);
    const otherSeat = 1 - seat;
    const otherDetail = await players[otherSeat].json(`/api/games/${created.id}`);
    assertNoLeak(actorDetail, otherDetail.view.hand);

    // Moving out of turn must be rejected.
    if (
      !otherDetail.view.isYourTurn &&
      actorDetail.view.phase === "pegging" &&
      otherDetail.view.unplayed.length > 0
    ) {
      const cheat = await players[otherSeat].fetch(`/api/games/${created.id}/move`, {
        method: "POST",
        body: JSON.stringify({
          type: "play",
          card: otherDetail.view.unplayed[0],
          version: otherDetail.version,
        }),
      });
      assert(cheat.status === 422, `out-of-turn play refused (got ${cheat.status})`);
    }

    detail = await actor.json(`/api/games/${created.id}/move`, {
      method: "POST",
      body: JSON.stringify({
        ...chooseMove(actorDetail.view),
        version: actorDetail.version,
      }),
    });
  }

  const winner = detail.view.winnerSeat;
  assert(winner !== null, "a winner is recorded");
  assert(detail.view.scores[winner] === 121, "the winner is on exactly 121");
  assert(detail.log.length > 0, "the action log has entries");
  assert(
    detail.log.some((e) => e.type === "show" && e.detail?.breakdown?.length),
    "show entries carry a scoring breakdown",
  );

  const finalLobby = await bob.json("/api/games");
  assert(finalLobby.games[0].status === "complete", "the lobby marks the game complete");
  assert(finalLobby.games[0].isYourTurn === false, "a finished game is nobody's turn");

  console.log("→ playing the computer");
  const cpu = await playTheComputer(alice, carol);
  assert(cpu.detail.view.winnerSeat !== null, "the computer game reaches a winner");
  assert(
    cpu.detail.view.scores[cpu.detail.view.winnerSeat] === 121,
    "the computer game ends on exactly 121",
  );

  console.log(
    `\n✓ ${moves} moves, ${detail.log.length} log entries, ${detail.view.handNumber} hands`,
  );
  console.log(
    `✓ computer game: ${cpu.moves} moves, ` +
      `${cpu.detail.view.scores[0]}–${cpu.detail.view.scores[1]}`,
  );
  console.log(
    `✓ winner: ${winner === 0 ? alice.name : bob.name} ` +
      `${detail.view.scores[winner]}–${detail.view.scores[1 - winner]}`,
  );
  console.log("✓ smoke test passed");
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
