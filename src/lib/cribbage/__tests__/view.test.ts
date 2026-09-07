import { describe, expect, it } from "vitest";
import { applyAction, createGame, otherSeat } from "../engine";
import { playerView, redactEvent } from "../view";
import { type Card, seededRng } from "../cards";
import type { GameEvent, GameState, Seat } from "../types";

const ctx = { names: ["Alice", "Bob"] as [string, string], rng: seededRng(3) };

function dealt(): GameState {
  return applyAction(createGame(), { type: "join" }, ctx).state;
}

/** Everything the payload could possibly expose, as a flat set of strings. */
function leaked(view: unknown): string {
  return JSON.stringify(view);
}

describe("player view", () => {
  it("shows you your own hand and nothing of the opponent's", () => {
    const state = dealt();
    const view = playerView(state, 0, "Bob");

    expect(view.hand).toEqual(state.hands[0]);
    expect(view.opponentHand).toBeNull();
    expect(view.opponentCardCount).toBe(6);

    for (const card of state.hands[1]) {
      expect(leaked(view)).not.toContain(`"${card}"`);
    }
  });

  it("never ships the undealt deck", () => {
    const state = dealt();
    const view = playerView(state, 1, "Alice");
    const undealt = state.deck.filter(
      (card) => !state.hands[0].includes(card) && !state.hands[1].includes(card),
    );
    // At least one undealt card must be absent — sample a few for speed.
    for (const card of undealt.slice(0, 12)) {
      expect(leaked(view)).not.toContain(`"${card}"`);
    }
  });

  it("hides the crib until it is turned up for counting", () => {
    let state = dealt();
    state = applyAction(
      state,
      { type: "discard", seat: 0, cards: state.hands[0].slice(0, 2) as [Card, Card] },
      ctx,
    ).state;
    state = applyAction(
      state,
      { type: "discard", seat: 1, cards: state.hands[1].slice(0, 2) as [Card, Card] },
      ctx,
    ).state;

    // Even the crib's owner cannot see the opponent's contribution early.
    for (const seat of [0, 1] as Seat[]) {
      const view = playerView(state, seat, "x");
      expect(view.crib).toBeNull();
      expect(view.cribSize).toBe(4);
    }
  });

  it("reveals hands and the crib in counting order", () => {
    const dealer: Seat = 0;
    const nonDealer = otherSeat(dealer);
    const base: GameState = {
      ...createGame(),
      phase: "counting",
      dealer,
      starter: "5D",
      hands: [
        ["5H", "5S", "5C", "JD"],
        ["2S", "3H", "7D", "9C"],
      ],
      crib: ["AS", "AH", "AD", "AC"],
    };

    // countIndex 0: the non-dealer is showing, so their hand is public.
    const atZero = playerView({ ...base, countIndex: 0 }, dealer, "x");
    expect(atZero.opponentHand).toEqual(base.hands[nonDealer]);
    expect(atZero.crib).toBeNull();

    // The non-dealer still cannot see the dealer's hand yet.
    const fromNonDealer = playerView({ ...base, countIndex: 0 }, nonDealer, "x");
    expect(fromNonDealer.opponentHand).toBeNull();

    // countIndex 1: the dealer is showing.
    expect(
      playerView({ ...base, countIndex: 1 }, nonDealer, "x").opponentHand,
    ).toEqual(base.hands[dealer]);

    // countIndex 2: the crib is turned up for both.
    expect(playerView({ ...base, countIndex: 2 }, nonDealer, "x").crib).toEqual(
      base.crib,
    );
  });

  it("reveals everything once the game is over", () => {
    const state: GameState = {
      ...dealt(),
      phase: "complete",
      winnerSeat: 0,
      crib: ["AS", "AH", "AD", "AC"],
    };
    const view = playerView(state, 1, "Alice");
    expect(view.opponentHand).toEqual(state.hands[0]);
    expect(view.crib).toEqual(state.crib);
  });

  it("only offers legal plays to the player on turn", () => {
    const state: GameState = {
      ...createGame(),
      phase: "pegging",
      starter: "2C",
      hands: [
        ["KS", "3S", "4S", "5S"],
        ["KH", "QH", "JH", "TH"],
      ],
      pegRemaining: [
        ["KS", "3S", "4S", "5S"],
        ["KH", "QH", "JH", "TH"],
      ],
      play: {
        turn: 0,
        total: 28,
        sequence: [],
        history: [],
        goSaid: [false, false],
        lastPlayer: 1,
      },
    };

    expect(playerView(state, 0, "x").legalPlays).toEqual(["3S"]);
    // Not your turn means no legal plays are offered at all.
    expect(playerView(state, 1, "x").legalPlays).toEqual([]);
  });

  it("writes a prompt that says whose move it is", () => {
    const state = dealt();
    expect(playerView(state, 0, "Bob").prompt).toMatch(/discard/i);
    expect(playerView(state, 0, "Bob").isYourTurn).toBe(true);

    const pegging: GameState = {
      ...state,
      phase: "pegging",
      play: { ...state.play, turn: 1, total: 12 },
    };
    expect(playerView(pegging, 0, "Bob").prompt).toBe("Waiting for Bob…");
    expect(playerView(pegging, 1, "Alice").prompt).toContain("count is 12");
  });
});

describe("log redaction", () => {
  const discardEvent: GameEvent = {
    type: "discard",
    seat: 0,
    message: "Alice laid two cards away to the crib.",
    handNumber: 1,
    detail: { cards: ["5H", "5S"] },
  };

  it("keeps your own discard visible to you", () => {
    expect(redactEvent(discardEvent, 0).detail?.cards).toEqual(["5H", "5S"]);
  });

  it("strips the cards from the opponent's discard", () => {
    const redacted = redactEvent(discardEvent, 1);
    expect(redacted.detail).toBeUndefined();
    expect(redacted.message).toBe(discardEvent.message);
  });

  it("leaves public events untouched", () => {
    const show: GameEvent = {
      type: "show",
      seat: 0,
      message: "Alice scores 29 in hand.",
      points: 29,
      handNumber: 1,
      detail: { cards: ["5H", "5S", "5C", "JD"], starter: "5D" },
    };
    expect(redactEvent(show, 1)).toEqual(show);
  });
});
