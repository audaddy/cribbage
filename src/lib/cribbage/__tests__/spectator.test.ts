/**
 * The television projection.
 *
 * This is the one view served without a session, so it gets tested the
 * paranoid way: not by checking the fields it fills in, but by serialising the
 * whole thing and hunting for cards nobody should be able to see.
 */

import { describe, expect, it } from "vitest";
import {
  type GameState,
  applyAction,
  createGame,
  legalPlaysFor,
  pendingSeats,
  spectatorView,
} from "../index";

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

const NAMES = ["North", "East", "South", "West"];

function dealt(variant: "two" | "three" | "teams", seed = 11): GameState {
  return applyAction(createGame(variant), { type: "join" }, {
    names: NAMES,
    rng: seeded(seed),
  }).state;
}

/** Every card held by anybody, plus the crib and the undealt deck. */
function secrets(state: GameState): string[] {
  return [...state.hands.flat(), ...state.crib, ...state.deck];
}

/** Cards that are legitimately public by now. */
function published(state: GameState): Set<string> {
  const open = new Set<string>(state.play.history.map((played) => played.card));
  if (state.starter) open.add(state.starter);
  return open;
}

function assertNothingLeaks(state: GameState) {
  const blob = JSON.stringify(spectatorView(state, NAMES));
  const open = published(state);
  for (const card of secrets(state)) {
    if (open.has(card)) continue;
    expect(
      blob.includes(`"${card}"`),
      `${card} is visible on the television in phase ${state.phase}`,
    ).toBe(false);
  }
}

describe("the television view", () => {
  it("shows no hand, no crib and no deck while a hand is being played", () => {
    for (const variant of ["two", "three", "teams"] as const) {
      assertNothingLeaks(dealt(variant));
    }
  });

  it("keeps holding them all the way through the play", () => {
    let state = dealt("two");
    const rng = seeded(4);
    for (let step = 0; step < 200 && state.phase !== "complete"; step += 1) {
      assertNothingLeaks(state);
      const seat = pendingSeats(state)[0]!;
      const action =
        state.phase === "discard"
          ? { type: "discard" as const, seat, cards: state.hands[seat]!.slice(0, 2) }
          : state.phase === "pegging"
            ? { type: "play" as const, seat, card: legalPlaysFor(state, seat)[0]! }
            : { type: "count" as const, seat };
      state = applyAction(state, action, { names: NAMES, rng }).state;
      // Stop at the show: from there hands are turned face up on purpose.
      if (state.phase === "counting") break;
    }
  });

  it("counts cards without naming them", () => {
    const view = spectatorView(dealt("three"), NAMES);
    expect(view.players.map((player) => player.cardCount)).toEqual([5, 5, 5]);
    expect(view.players.every((player) => player.hand === null)).toBe(true);
    expect(view.crib).toBeNull();
    expect(view.cribSize).toBe(1); // the card dealt straight to the crib
  });

  it("turns a hand face up only when its owner counts it", () => {
    const base = { ...dealt("two"), phase: "counting" as const, starter: "5D" as const };
    const first = (base.dealer + 1) % 2;
    const atZero = spectatorView({ ...base, countIndex: 0 }, NAMES);
    expect(atZero.players[first]!.hand).not.toBeNull();
    expect(atZero.players[base.dealer]!.hand).toBeNull();
    expect(atZero.crib).toBeNull();

    const atCrib = spectatorView({ ...base, countIndex: 2 }, NAMES);
    expect(atCrib.crib).not.toBeNull();
  });

  it("says what the room is waiting for", () => {
    expect(spectatorView(dealt("two"), NAMES).headline).toMatch(/discard/i);
    expect(spectatorView(createGame("three"), NAMES).headline).toMatch(/waiting/i);
  });
});
