/**
 * The three- and four-handed games.
 *
 * These assert the things that actually differ from heads-up: how the cards
 * are dealt, who leads, who counts in what order, and — for partnerships —
 * that two people push the same peg.
 */

import { describe, expect, it } from "vitest";
import {
  VARIANTS,
  type GameState,
  type Seat,
  applyAction,
  counterSeat,
  countingCrib,
  createGame,
  legalPlaysFor,
  nextSeat,
  pendingSeats,
  seatsOnTrack,
  trackOf,
} from "../index";

/** Deterministic RNG so a dealt hand is reproducible. */
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

const NAMES = ["North", "East", "South", "West"];

function start(variant: "three" | "teams", seed = 7): GameState {
  const { state } = applyAction(createGame(variant), { type: "join" }, {
    names: NAMES,
    rng: seeded(seed),
  });
  return state;
}

/** Plays a whole hand, taking the first legal option at every decision. */
function playOut(start: GameState, limit = 400): GameState {
  let state = start;
  const rng = seeded(99);
  for (let step = 0; step < limit; step += 1) {
    const seats = pendingSeats(state);
    if (seats.length === 0) return state;
    const seat = seats[0]!;
    const spec = VARIANTS[state.variant];
    if (state.phase === "discard") {
      state = applyAction(
        state,
        { type: "discard", seat, cards: state.hands[seat]!.slice(0, spec.discards) },
        { names: NAMES, rng },
      ).state;
    } else if (state.phase === "pegging") {
      state = applyAction(
        state,
        { type: "play", seat, card: legalPlaysFor(state, seat)[0]! },
        { names: NAMES, rng },
      ).state;
    } else {
      state = applyAction(state, { type: "count", seat }, { names: NAMES, rng }).state;
    }
  }
  throw new Error("hand did not finish");
}

describe("three-handed", () => {
  it("deals five each and starts the crib with one off the deck", () => {
    const state = start("three");
    expect(state.seats).toBe(3);
    expect(state.hands.map((hand) => hand.length)).toEqual([5, 5, 5]);
    // Nobody has discarded yet, so the only card in the crib came off the deck.
    expect(state.crib).toHaveLength(1);
    expect(state.deck).toHaveLength(52 - 15 - 1);
  });

  it("builds a four-card crib once everyone has paid in", () => {
    let state = start("three");
    for (const seat of [0, 1, 2] as Seat[]) {
      state = applyAction(
        state,
        { type: "discard", seat, cards: [state.hands[seat]![0]!] },
        { names: NAMES, rng: seeded(3) },
      ).state;
    }
    expect(state.crib).toHaveLength(4);
    expect(state.hands.map((hand) => hand.length)).toEqual([4, 4, 4]);
    expect(state.phase).toBe("pegging");
  });

  it("refuses two cards where the rules ask for one", () => {
    const state = start("three");
    expect(() =>
      applyAction(
        state,
        { type: "discard", seat: 0, cards: state.hands[0]!.slice(0, 2) },
        { names: NAMES },
      ),
    ).toThrow(/exactly one/);
  });

  it("leads from the dealer's left", () => {
    let state = start("three");
    for (const seat of [0, 1, 2] as Seat[]) {
      state = applyAction(
        state,
        { type: "discard", seat, cards: [state.hands[seat]![0]!] },
        { names: NAMES, rng: seeded(3) },
      ).state;
    }
    expect(state.play.turn).toBe(nextSeat(state, state.dealer));
  });

  it("counts round the table, dealer last, then the crib", () => {
    const state = { ...start("three"), phase: "counting" as const, countIndex: 0 };
    const order: Seat[] = [];
    for (let index = 0; index <= state.seats; index += 1) {
      order.push(counterSeat({ ...state, countIndex: index }));
    }
    const dealer = state.dealer;
    expect(order).toEqual([
      (dealer + 1) % 3,
      (dealer + 2) % 3,
      dealer,
      dealer, // the crib, turned by the dealer
    ]);
    expect(countingCrib({ ...state, countIndex: 2 })).toBe(false);
    expect(countingCrib({ ...state, countIndex: 3 })).toBe(true);
  });

  it("keeps three separate scores", () => {
    const state = start("three");
    expect(state.scores).toHaveLength(3);
    expect([0, 1, 2].map((seat) => trackOf(state, seat))).toEqual([0, 1, 2]);
  });

  it("plays a hand through to the next deal", () => {
    const state = playOut(start("three"));
    expect(state.handNumber).toBeGreaterThanOrEqual(2);
    expect(state.phase === "discard" || state.phase === "complete").toBe(true);
  });
});

describe("partnerships", () => {
  it("seats four and partners them across the table", () => {
    const state = start("teams");
    expect(state.seats).toBe(4);
    expect(state.hands.map((hand) => hand.length)).toEqual([5, 5, 5, 5]);
    expect(state.crib).toHaveLength(0); // four players each owe one
    expect(seatsOnTrack(state, 0)).toEqual([0, 2]);
    expect(seatsOnTrack(state, 1)).toEqual([1, 3]);
  });

  it("pegs partners onto one score", () => {
    const state = start("teams");
    expect(state.scores).toHaveLength(2);
    expect(trackOf(state, 0)).toBe(trackOf(state, 2));
    expect(trackOf(state, 1)).toBe(trackOf(state, 3));
    expect(trackOf(state, 0)).not.toBe(trackOf(state, 1));
  });

  it("credits a partner's points to the shared score", () => {
    let state = start("teams");
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      state = applyAction(
        state,
        { type: "discard", seat, cards: [state.hands[seat]![0]!] },
        { names: NAMES, rng: seeded(5) },
      ).state;
    }
    const before = [...state.scores];
    // Walk the play until somebody pegs, then check whose track moved.
    for (let step = 0; step < 40 && state.phase === "pegging"; step += 1) {
      const seat = state.play.turn;
      const { state: after, events } = applyAction(
        state,
        { type: "play", seat, card: legalPlaysFor(state, seat)[0]! },
        { names: NAMES, rng: seeded(5) },
      );
      const pegged = events.find((event) => event.type === "peg" && (event.points ?? 0) > 0);
      state = after;
      if (pegged) {
        const track = trackOf(state, pegged.seat!);
        expect(state.scores[track]).toBeGreaterThan(before[track]!);
        return;
      }
    }
  });

  it("counts all four hands before the crib", () => {
    const state = { ...start("teams"), phase: "counting" as const, countIndex: 0 };
    const dealer = state.dealer;
    const order = [0, 1, 2, 3].map((index) => counterSeat({ ...state, countIndex: index }));
    expect(order).toEqual([
      (dealer + 1) % 4,
      (dealer + 2) % 4,
      (dealer + 3) % 4,
      dealer,
    ]);
    expect(countingCrib({ ...state, countIndex: 4 })).toBe(true);
  });

  it("plays a hand through to the next deal", () => {
    const state = playOut(start("teams"));
    expect(state.handNumber).toBeGreaterThanOrEqual(2);
    expect(state.phase === "discard" || state.phase === "complete").toBe(true);
  });
});

describe("schema 1 states", () => {
  it("keeps a game that predates the other variants playable", () => {
    // Exactly what a heads-up game looked like before variants existed.
    const legacy = {
      ...createGame("two"),
      schema: 1,
      variant: undefined,
      seats: undefined,
    } as unknown as GameState;

    const { state } = applyAction(legacy, { type: "join" }, { names: NAMES });
    expect(state.schema).toBe(2);
    expect(state.variant).toBe("two");
    expect(state.seats).toBe(2);
    expect(state.hands.map((hand) => hand.length)).toEqual([6, 6]);
  });
});
