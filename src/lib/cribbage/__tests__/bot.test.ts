import { describe, expect, it } from "vitest";
import { type Card, fullDeck, seededRng, shuffle, sortCards } from "../cards";
import { applyAction, createGame, legalPlaysFor, pendingSeats } from "../engine";
import { chooseAction, chooseDiscard } from "../bot";
import type { GameState, Seat } from "../types";

const names: [string, string] = ["Computer", "Naive"];

/** The throwaway strategy the dev bot uses: no thought at all. */
function naiveAction(state: GameState, seat: Seat) {
  if (state.phase === "discard") {
    const sorted = sortCards(state.hands[seat]);
    return { type: "discard" as const, cards: [sorted[4]!, sorted[5]!] as [Card, Card] };
  }
  if (state.phase === "pegging") {
    return { type: "play" as const, card: legalPlaysFor(state, seat)[0]! };
  }
  return { type: "count" as const };
}

/** Plays one full game; seat 0 is the computer, seat 1 is naive. */
function playGame(seed: number): { winner: Seat; scores: number[] } {
  const rng = seededRng(seed);
  let state = applyAction(createGame(), { type: "join" }, { names, rng }).state;

  for (let step = 0; step < 5000 && state.phase !== "complete"; step++) {
    const seat = pendingSeats(state)[0]!;
    const action =
      seat === 0 ? chooseAction(state, seat, rng)! : naiveAction(state, seat);
    state = applyAction(state, { ...action, seat } as never, { names, rng }).state;
  }

  return { winner: state.winnerSeat!, scores: state.scores };
}

describe("the computer opponent", () => {
  it("weighs the crib differently depending on who owns it", () => {
    // Whose crib it is has to change some decisions, or the sign on the crib
    // term is doing nothing. Not every hand flips — often one keep dominates
    // regardless — so this looks across a sample.
    const rng = seededRng(11);
    let flipped = 0;
    for (let i = 0; i < 25; i++) {
      const hand = shuffle(fullDeck(), rng).slice(0, 6);
      const asDealer = chooseDiscard(hand, true, seededRng(99)).slice().sort();
      const asPone = chooseDiscard(hand, false, seededRng(99)).slice().sort();
      if (asDealer.join() !== asPone.join()) flipped += 1;
    }
    expect(flipped).toBeGreaterThan(0);
  });

  it("keeps a made hand rather than breaking it up", () => {
    // 4-5-6 is a run and a fifteen at once. Which ten-card it keeps alongside
    // is nearly a coin flip, but breaking the run never is.
    const toss = chooseDiscard(["4S", "5H", "6D", "JC", "2C", "KH"], true, seededRng(7));
    expect(toss).not.toContain("4S");
    expect(toss).not.toContain("5H");
    expect(toss).not.toContain("6D");
  });

  it("never leads a five", () => {
    // A five invites a third of the deck to answer for fifteen.
    for (const seed of [1, 2, 3, 4, 5]) {
      const state: GameState = {
        ...createGame(),
        phase: "pegging",
        starter: "2C",
        hands: [["5H", "4S", "9D", "KC"], ["3D", "7S", "QH", "TC"]],
        pegRemaining: [["5H", "4S", "9D", "KC"], ["3D", "7S", "QH", "TC"]],
        play: { turn: 0, total: 0, sequence: [], history: [], goSaid: [false, false], lastPlayer: null },
      };
      const action = chooseAction(state, 0, seededRng(seed));
      expect(action).toEqual({ type: "play", card: expect.not.stringMatching(/^5/) });
    }
  });

  it("takes the fifteen when one is on offer", () => {
    const state: GameState = {
      ...createGame(),
      phase: "pegging",
      starter: "2C",
      hands: [["7H", "KC", "9D", "3S"], ["8D", "QH", "TC", "4S"]],
      pegRemaining: [["7H", "KC", "9D", "3S"], ["8D", "QH", "TC", "4S"]],
      play: {
        turn: 0, total: 8, goSaid: [false, false], lastPlayer: 1,
        sequence: [{ seat: 1, card: "8D", total: 8 }],
        history: [{ seat: 1, card: "8D", total: 8 }],
      },
    };
    expect(chooseAction(state, 0, seededRng(3))).toEqual({ type: "play", card: "7H" });
  });

  // A full game is ~11 deals and each discard is solved exactly, so this is
  // seconds of real work rather than milliseconds.
  it("beats the naive strategy over a run of games", { timeout: 120_000 }, () => {
    const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
    const results = seeds.map(playGame);
    const wins = results.filter((r) => r.winner === 0).length;
    console.log(`    computer won ${wins}/${seeds.length}`);

    // Cribbage has real luck in it, so this is a margin rather than a rout.
    // Anything at or below half would mean the strategy is not working.
    expect(wins).toBeGreaterThan(seeds.length * 0.62);
  });
});
