import { describe, expect, it } from "vitest";
import { fullDeck, seededRng } from "../cards";
import {
  applyAction,
  createGame,
  legalPlaysFor,
  pendingSeats,
  turnSeat,
} from "../engine";
import { IllegalMoveError, type Card, type GameState, type Seat } from "../index";

const names: [string, string] = ["Alice", "Bob"];
const ctx = (seed = 1) => ({ names, rng: seededRng(seed) });

/** Starts a game and returns the state after the opening deal. */
function dealtGame(seed = 1): GameState {
  return applyAction(createGame(), { type: "join" }, ctx(seed)).state;
}

/** Hand-built state so a scenario can be set up exactly. */
function scenario(patch: Partial<GameState>): GameState {
  const base = createGame();
  return {
    ...base,
    ...patch,
    play: { ...base.play, ...(patch.play ?? {}) },
  };
}

describe("game setup", () => {
  it("starts waiting for an opponent with nobody to act", () => {
    const state = createGame();
    expect(state.phase).toBe("awaiting_opponent");
    expect(pendingSeats(state)).toEqual([]);
    expect(turnSeat(state)).toBeNull();
  });

  it("deals six cards each and leaves forty in the deck", () => {
    const state = dealtGame();
    expect(state.phase).toBe("discard");
    expect(state.handNumber).toBe(1);
    expect(state.hands[0]).toHaveLength(6);
    expect(state.hands[1]).toHaveLength(6);
    expect(state.deck).toHaveLength(40);
    const all = [...state.hands[0], ...state.hands[1], ...state.deck];
    expect(new Set(all).size).toBe(52);
  });

  it("waits on both players to discard", () => {
    const state = dealtGame();
    expect(pendingSeats(state).sort()).toEqual([0, 1]);
    expect(turnSeat(state)).toBeNull();
  });

  it("refuses to start twice", () => {
    expect(() => applyAction(dealtGame(), { type: "join" }, ctx())).toThrow(
      IllegalMoveError,
    );
  });
});

describe("discarding", () => {
  it("moves four cards to the crib and cuts the starter", () => {
    let state = dealtGame();
    const d0 = state.hands[0].slice(0, 2) as [Card, Card];
    const d1 = state.hands[1].slice(0, 2) as [Card, Card];

    state = applyAction(state, { type: "discard", seat: 0, cards: d0 }, ctx()).state;
    expect(state.phase).toBe("discard");
    expect(pendingSeats(state)).toEqual([1]);

    state = applyAction(state, { type: "discard", seat: 1, cards: d1 }, ctx()).state;
    expect(state.phase).toBe("pegging");
    expect(state.crib).toHaveLength(4);
    expect(state.hands[0]).toHaveLength(4);
    expect(state.hands[1]).toHaveLength(4);
    expect(state.starter).not.toBeNull();
    expect(state.deck).toHaveLength(39);
  });

  it("gives the lead to the non-dealer", () => {
    let state = dealtGame();
    state = applyAction(
      state,
      { type: "discard", seat: 0, cards: state.hands[0].slice(0, 2) as [Card, Card] },
      ctx(),
    ).state;
    state = applyAction(
      state,
      { type: "discard", seat: 1, cards: state.hands[1].slice(0, 2) as [Card, Card] },
      ctx(),
    ).state;
    expect(state.play.turn).toBe(1 - state.dealer);
  });

  it("rejects discarding a card you do not hold", () => {
    const state = dealtGame();
    const notHeld = fullDeck().filter((c) => !state.hands[0].includes(c));
    expect(() =>
      applyAction(
        state,
        { type: "discard", seat: 0, cards: [notHeld[0]!, notHeld[1]!] },
        ctx(),
      ),
    ).toThrow(/do not hold/);
  });

  it("rejects the wrong number of cards and duplicates", () => {
    const state = dealtGame();
    expect(() =>
      applyAction(
        state,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: "discard", seat: 0, cards: [state.hands[0][0]!] as any },
        ctx(),
      ),
    ).toThrow(/exactly two/);
    expect(() =>
      applyAction(
        state,
        { type: "discard", seat: 0, cards: [state.hands[0][0]!, state.hands[0][0]!] },
        ctx(),
      ),
    ).toThrow(/two different/);
  });

  it("rejects discarding twice", () => {
    let state = dealtGame();
    state = applyAction(
      state,
      { type: "discard", seat: 0, cards: state.hands[0].slice(0, 2) as [Card, Card] },
      ctx(),
    ).state;
    expect(() =>
      applyAction(
        state,
        { type: "discard", seat: 0, cards: state.hands[0].slice(0, 2) as [Card, Card] },
        ctx(),
      ),
    ).toThrow(/already discarded/);
  });

  it("does not leak the crib's contents into the deck count", () => {
    let state = dealtGame();
    state = applyAction(
      state,
      { type: "discard", seat: 0, cards: state.hands[0].slice(0, 2) as [Card, Card] },
      ctx(),
    ).state;
    state = applyAction(
      state,
      { type: "discard", seat: 1, cards: state.hands[1].slice(0, 2) as [Card, Card] },
      ctx(),
    ).state;
    const seen = [
      ...state.hands[0],
      ...state.hands[1],
      ...state.crib,
      ...state.deck,
      state.starter!,
    ];
    expect(new Set(seen).size).toBe(52);
  });
});

describe("his heels", () => {
  const heelsSetup = (scores: [number, number]) =>
    scenario({
      phase: "discard",
      dealer: 0,
      handNumber: 1,
      scores,
      hands: [
        ["AS", "2S", "3S", "4S", "5S", "6S"],
        ["AH", "2H", "3H", "4H", "5H", "6H"],
      ],
      deck: ["2C", "3C", "JD"],
    });

  it("gives the dealer two when a jack is cut", () => {
    let state = heelsSetup([0, 0]);
    state = applyAction(state, { type: "discard", seat: 0, cards: ["5S", "6S"] }, ctx())
      .state;
    const result = applyAction(
      state,
      { type: "discard", seat: 1, cards: ["5H", "6H"] },
      ctx(),
    );
    expect(result.state.starter).toBe("JD");
    expect(result.state.scores[0]).toBe(2);
    expect(result.state.phase).toBe("pegging");
    expect(result.events.some((e) => e.message.includes("his heels"))).toBe(true);
  });

  it("can win the game outright", () => {
    let state = heelsSetup([120, 0]);
    state = applyAction(state, { type: "discard", seat: 0, cards: ["5S", "6S"] }, ctx())
      .state;
    const result = applyAction(
      state,
      { type: "discard", seat: 1, cards: ["5H", "6H"] },
      ctx(),
    );
    expect(result.state.phase).toBe("complete");
    expect(result.state.winnerSeat).toBe(0);
    expect(result.state.scores[0]).toBe(121);
  });
});

describe("the play", () => {
  /** Dealer 0, non-dealer 1 leads, with hands chosen for the scenario. */
  const playSetup = (hands: [Card[], Card[]], patch: Partial<GameState> = {}) =>
    scenario({
      phase: "pegging",
      dealer: 0,
      handNumber: 1,
      starter: "2C",
      hands: [hands[0].slice(), hands[1].slice()],
      pegRemaining: [hands[0].slice(), hands[1].slice()],
      play: { turn: 1, total: 0, sequence: [], history: [], goSaid: [false, false], lastPlayer: null },
      ...patch,
    });

  it("rejects playing out of turn", () => {
    const state = playSetup([["KS", "QS", "JS", "TS"], ["KH", "QH", "JH", "TH"]]);
    expect(() =>
      applyAction(state, { type: "play", seat: 0, card: "KS" }, ctx()),
    ).toThrow(/not your turn/);
  });

  it("rejects a card that would take the count past 31", () => {
    const state = playSetup(
      [["KS", "QS", "JS", "TS"], ["KH", "QH", "JH", "3H"]],
      { play: { turn: 1, total: 29, sequence: [], history: [], goSaid: [false, false], lastPlayer: 0 } },
    );
    expect(() =>
      applyAction(state, { type: "play", seat: 1, card: "KH" }, ctx()),
    ).toThrow(/past 31/);
    expect(legalPlaysFor(state, 1)).toEqual([]);
  });

  it("rejects a card the player does not hold", () => {
    const state = playSetup([["KS", "QS", "JS", "TS"], ["KH", "QH", "JH", "TH"]]);
    expect(() =>
      applyAction(state, { type: "play", seat: 1, card: "5D" }, ctx()),
    ).toThrow(/do not hold/);
  });

  it("pegs a fifteen", () => {
    let state = playSetup([["8S", "QS", "JS", "TS"], ["7H", "QH", "JH", "TH"]]);
    state = applyAction(state, { type: "play", seat: 1, card: "7H" }, ctx()).state;
    const result = applyAction(state, { type: "play", seat: 0, card: "8S" }, ctx());
    expect(result.state.scores[0]).toBe(2);
    expect(result.state.play.total).toBe(15);
  });

  it("declares a go automatically and awards the point", () => {
    // Non-dealer leads a king; both players run out of playable cards at 30.
    let state = playSetup([["KS", "QS", "9S", "8S"], ["KH", "QH", "9H", "8H"]]);
    state = applyAction(state, { type: "play", seat: 1, card: "KH" }, ctx()).state; // 10
    state = applyAction(state, { type: "play", seat: 0, card: "KS" }, ctx()).state; // 20
    const result = applyAction(state, { type: "play", seat: 1, card: "9H" }, ctx()); // 29

    // Seat 0 holds only tens and a nine — nothing fits under 31, so it says go.
    expect(result.events.some((e) => e.type === "go" && e.seat === 0)).toBe(true);
    // Seat 1 laid the last card, so it takes one for the go.
    expect(result.state.scores[1]).toBe(1);
    // The count resets and seat 0 leads the new sequence.
    expect(result.state.play.total).toBe(0);
    expect(result.state.play.sequence).toEqual([]);
    expect(result.state.play.turn).toBe(0);
  });

  it("awards two for thirty-one instead of a go point", () => {
    let state = playSetup([["AS", "QS", "JS", "TS"], ["KH", "QH", "JH", "TH"]]);
    state = applyAction(state, { type: "play", seat: 1, card: "KH" }, ctx()).state; // 10
    state = applyAction(state, { type: "play", seat: 0, card: "QS" }, ctx()).state; // 20
    state = applyAction(state, { type: "play", seat: 1, card: "QH" }, ctx()).state; // 30
    const result = applyAction(state, { type: "play", seat: 0, card: "AS" }, ctx()); // 31

    expect(result.state.scores[0]).toBe(2);
    expect(result.events.some((e) => e.message.includes("go"))).toBe(false);
    expect(result.state.play.total).toBe(0);
    // After 31 the opponent of the player who hit it leads.
    expect(result.state.play.turn).toBe(1);
  });

  it("awards one for the last card and moves to the show", () => {
    // Four cards each, all tens; the play ends without reaching 31.
    let state = playSetup([["KS", "QS", "JS", "TS"], ["KH", "QH", "JH", "TH"]]);
    const order: Array<[Seat, Card]> = [
      [1, "KH"], [0, "KS"], [1, "QH"], [0, "QS"],
      [1, "JH"], [0, "JS"], [1, "TH"], [0, "TS"],
    ];
    let events: ReturnType<typeof applyAction>["events"] = [];
    for (const [seat, card] of order) {
      const result = applyAction(state, { type: "play", seat, card }, ctx());
      state = result.state;
      events = result.events;
    }
    expect(events.some((e) => e.message.includes("last card"))).toBe(true);
    expect(state.phase).toBe("counting");
    expect(state.countIndex).toBe(0);
    // Non-dealer counts first.
    expect(pendingSeats(state)).toEqual([1]);
  });
});

describe("the show", () => {
  const showSetup = (patch: Partial<GameState> = {}) =>
    scenario({
      phase: "counting",
      dealer: 0,
      handNumber: 1,
      countIndex: 0,
      starter: "5D",
      hands: [
        ["5H", "5S", "5C", "JD"], // dealer: the 29 hand
        ["2S", "3H", "7D", "9C"], // non-dealer: one fifteen, worth 2
      ],
      crib: ["AS", "AH", "AD", "AC"],
      pegRemaining: [[], []],
      ...patch,
    });

  it("counts non-dealer's hand, then dealer's hand, then the crib", () => {
    let state = showSetup();
    expect(pendingSeats(state)).toEqual([1]);

    let result = applyAction(state, { type: "count", seat: 1 }, ctx());
    state = result.state;
    expect(state.scores[1]).toBe(2); // 3 + 7 + 5 is the only fifteen
    expect(state.countIndex).toBe(1);
    expect(pendingSeats(state)).toEqual([0]);

    result = applyAction(state, { type: "count", seat: 0 }, ctx());
    state = result.state;
    expect(state.scores[0]).toBe(29);
    expect(state.countIndex).toBe(2);

    result = applyAction(state, { type: "count", seat: 0 }, ctx());
    state = result.state;
    // Four aces in the crib: six pairs = 12.
    expect(state.scores[0]).toBe(29 + 12);
    // The hand is over: the deal passes and a new hand begins.
    expect(state.phase).toBe("discard");
    expect(state.handNumber).toBe(2);
    expect(state.dealer).toBe(1);
  });

  it("rejects counting out of turn", () => {
    const state = showSetup();
    expect(() => applyAction(state, { type: "count", seat: 0 }, ctx())).toThrow(
      /not your count/,
    );
  });

  it("includes a scoring breakdown in the event log", () => {
    const state = showSetup({ countIndex: 1 });
    const result = applyAction(state, { type: "count", seat: 0 }, ctx());
    const show = result.events.find((e) => e.type === "show");
    expect(show?.points).toBe(29);
    expect(show?.detail?.breakdown?.length).toBeGreaterThan(0);
    expect(
      show!.detail!.breakdown!.reduce((sum, item) => sum + item.points, 0),
    ).toBe(29);
  });

  it("ends the game the moment the target is reached, mid-show", () => {
    const state = showSetup({ countIndex: 1, scores: [100, 0] });
    const result = applyAction(state, { type: "count", seat: 0 }, ctx());
    expect(result.state.phase).toBe("complete");
    expect(result.state.winnerSeat).toBe(0);
    expect(result.state.scores[0]).toBe(121);
    // The crib is never counted — the game is already won.
    expect(result.state.countIndex).toBe(1);
    expect(pendingSeats(result.state)).toEqual([]);
  });

  it("never scores past the target", () => {
    const state = showSetup({ countIndex: 1, scores: [110, 0] });
    const result = applyAction(state, { type: "count", seat: 0 }, ctx());
    expect(result.state.scores[0]).toBe(121);
  });
});

describe("immutability", () => {
  it("does not mutate the state passed in", () => {
    const state = dealtGame();
    const snapshot = JSON.stringify(state);
    applyAction(
      state,
      { type: "discard", seat: 0, cards: state.hands[0].slice(0, 2) as [Card, Card] },
      ctx(),
    );
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe("full game simulation", () => {
  /**
   * Plays complete games with a trivial bot on both seats. This is the safety
   * net for the state machine: any unreachable state, stuck turn or scoring
   * runaway shows up as a non-terminating or invalid game.
   */
  function playOut(seed: number) {
    // A single context per game, so the RNG advances between deals.
    const c = { names, rng: seededRng(seed) };
    let state = applyAction(createGame(), { type: "join" }, c).state;
    let steps = 0;

    while (state.phase !== "complete") {
      if (steps++ > 5000) throw new Error("game did not terminate");
      const pending = pendingSeats(state);
      expect(pending.length).toBeGreaterThan(0);
      const seat = pending[0]!;

      if (state.phase === "discard") {
        state = applyAction(
          state,
          { type: "discard", seat, cards: state.hands[seat].slice(4, 6) as [Card, Card] },
          c,
        ).state;
      } else if (state.phase === "pegging") {
        const legal = legalPlaysFor(state, seat);
        expect(legal.length).toBeGreaterThan(0);
        state = applyAction(state, { type: "play", seat, card: legal[0]! }, c).state;
      } else if (state.phase === "counting") {
        state = applyAction(state, { type: "count", seat }, c).state;
      }

      expect(state.scores[0]).toBeLessThanOrEqual(121);
      expect(state.scores[1]).toBeLessThanOrEqual(121);
    }
    return state;
  }

  it("always reaches a winner at exactly the target score", () => {
    for (const seed of [1, 2, 3, 17, 42, 99, 1234, 20260907]) {
      const state = playOut(seed);
      expect(state.winnerSeat).not.toBeNull();
      expect(state.scores[state.winnerSeat!]).toBe(121);
      expect(state.scores[1 - state.winnerSeat!]).toBeLessThan(121);
      expect(pendingSeats(state)).toEqual([]);
    }
  });

  it("never loses a card during a hand", () => {
    const c = { names, rng: seededRng(5) };
    let state = applyAction(createGame(), { type: "join" }, c).state;
    for (let i = 0; i < 60 && state.phase !== "complete"; i++) {
      const seat = pendingSeats(state)[0]!;
      if (state.phase === "discard") {
        state = applyAction(
          state,
          { type: "discard", seat, cards: state.hands[seat].slice(4, 6) as [Card, Card] },
          c,
        ).state;
      } else if (state.phase === "pegging") {
        state = applyAction(
          state,
          { type: "play", seat, card: legalPlaysFor(state, seat)[0]! },
          c,
        ).state;
        const seen = [
          ...state.hands[0], ...state.hands[1], ...state.crib,
          ...state.deck, state.starter!,
        ];
        expect(new Set(seen).size).toBe(52);
      } else {
        state = applyAction(state, { type: "count", seat }, c).state;
      }
    }
  });
});
