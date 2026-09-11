/**
 * Per-seat projections of the game state.
 *
 * The server never ships a raw `GameState` to a client: it would contain every
 * other player's hand, the crib and the undealt deck. `playerView` produces
 * exactly what one seat is entitled to see at this moment.
 *
 * With more than two at the table "the opponent" stops being a single person,
 * so everything about the others is reported as a list indexed by seat.
 */

import type { Card } from "./cards";
import {
  counterSeat,
  countingCrib,
  currentCountLabel,
  legalPlaysFor,
  pendingSeats,
  seatsOnTrack,
  specOf,
  trackOf,
} from "./engine";
import type { GameEvent, GameState, PlayedCard, Seat, Variant } from "./types";

/** What one viewer can see of somebody else at the table. */
export interface OpponentView {
  seat: Seat;
  name: string;
  /** Scoring track, so partners can be drawn as one side. */
  track: number;
  /** True when this player shares the viewer's score. */
  isPartner: boolean;
  /** Cards held, without saying which. */
  cardCount: number;
  /** Their kept hand, once the show has revealed it. */
  hand: Card[] | null;
  hasDiscarded: boolean;
  saidGo: boolean;
}

export interface PlayerView {
  phase: GameState["phase"];
  variant: Variant;
  seats: number;
  handNumber: number;
  target: number;
  /** The viewing seat. */
  you: Seat;
  /** The viewer's scoring track: their own, or their partnership's. */
  yourTrack: number;
  dealer: Seat;
  /** True when the viewer holds the deal, and therefore the crib. */
  youAreDealer: boolean;
  /** True when the deal belongs to the viewer's partner. */
  partnerDeals: boolean;
  /** One score per track: per player, or per partnership. */
  scores: number[];
  prevScores: number[];
  /** How many cards each player owes the crib this hand. */
  discardsOwed: number;

  /** The viewer's cards. */
  hand: Card[];
  /** Subset of `hand` not yet laid during the play. */
  unplayed: Card[];
  /** Cards the viewer may legally lay right now. */
  legalPlays: Card[];

  /** Everyone else, in seating order starting to the viewer's left. */
  opponents: OpponentView[];

  /** The crib, once it is turned up for counting. */
  crib: Card[] | null;
  cribSize: number;

  starter: Card | null;

  play: {
    turn: Seat;
    total: number;
    sequence: PlayedCard[];
    history: PlayedCard[];
    /** Who has said "go" in this count. A go is announced, so this is public. */
    goSaid: boolean[];
  };

  countIndex: number;
  /** Whose hand, or the crib, is being counted. */
  countLabel: string | null;
  /** Seat whose count is due. */
  counter: Seat | null;

  pending: Seat[];
  isYourTurn: boolean;
  winnerSeat: Seat | null;
  /** Track that won, so the board can mark the winning side. */
  winnerTrack: number | null;
  /** Short instruction rendered as the turn indicator. */
  prompt: string;
}

function handVisible(state: GameState, seat: Seat): boolean {
  if (state.phase === "complete") return true;
  if (state.phase !== "counting") return false;
  // A hand goes face up when its owner's count comes round, not after it —
  // you lay the cards out to count them. The show runs from the dealer's left,
  // so position 0 is the first to show and the dealer is last.
  const position = (seat - state.dealer - 1 + state.seats) % state.seats;
  return state.countIndex >= position;
}

function cribVisible(state: GameState): boolean {
  return state.phase === "complete" || (state.phase === "counting" && countingCrib(state));
}

/** Everyone else, starting to the viewer's left so the table reads clockwise. */
function othersFrom(state: GameState, seat: Seat): Seat[] {
  return Array.from({ length: state.seats - 1 }, (_, step) => (seat + 1 + step) % state.seats);
}

function buildPrompt(
  state: GameState,
  seat: Seat,
  isYourTurn: boolean,
  names: string[],
): string {
  if (state.phase === "awaiting_opponent") {
    const waiting = state.seats - 1;
    return waiting === 1
      ? "Waiting for your opponent to accept the invite…"
      : `Waiting for ${waiting} more players to join…`;
  }
  if (state.phase === "complete") {
    if (state.winnerSeat === null) return "Game over.";
    const won = trackOf(state, state.winnerSeat) === trackOf(state, seat);
    if (won) return specOf(state).partnerships ? "Your side won!" : "You won!";
    return `${names[state.winnerSeat] ?? "Your opponent"} won.`;
  }
  if (!isYourTurn) {
    const pending = pendingSeats(state);
    if (pending.length > 1) return "Waiting for the others to discard…";
    const who = pending[0] !== undefined ? names[pending[0]] : undefined;
    return `Waiting for ${who ?? "your opponent"}…`;
  }
  switch (state.phase) {
    case "discard": {
      const owed = specOf(state).discards === 1 ? "a card" : "two cards";
      if (state.dealer === seat) return `Discard ${owed} to your crib.`;
      if (specOf(state).partnerships && trackOf(state, state.dealer) === trackOf(state, seat)) {
        return `Discard ${owed} to your partner's crib.`;
      }
      return `Discard ${owed} to ${names[state.dealer] ?? "the dealer"}'s crib.`;
    }
    case "pegging":
      return `Play a card — the count is ${state.play.total}.`;
    case "counting":
      return countingCrib(state) ? "Count your crib." : "Count your hand.";
    default:
      return "Your turn!";
  }
}

export function playerView(
  state: GameState,
  seat: Seat,
  names: string[] = [],
): PlayerView {
  const pending = pendingSeats(state);
  const isYourTurn = pending.includes(seat);
  const spec = specOf(state);
  const yourTrack = trackOf(state, seat);

  const opponents: OpponentView[] = othersFrom(state, seat).map((other) => ({
    seat: other,
    name: names[other] ?? `Player ${other + 1}`,
    track: trackOf(state, other),
    isPartner: spec.partnerships && trackOf(state, other) === yourTrack,
    cardCount:
      state.phase === "pegging"
        ? (state.pegRemaining[other]?.length ?? 0)
        : (state.hands[other]?.length ?? 0),
    hand: handVisible(state, other) ? [...(state.hands[other] ?? [])] : null,
    hasDiscarded: state.discarded[other] ?? false,
    saidGo: state.play.goSaid[other] ?? false,
  }));

  return {
    phase: state.phase,
    variant: state.variant,
    seats: state.seats,
    handNumber: state.handNumber,
    target: state.target,
    you: seat,
    yourTrack,
    dealer: state.dealer,
    youAreDealer: state.dealer === seat,
    partnerDeals:
      spec.partnerships &&
      state.dealer !== seat &&
      trackOf(state, state.dealer) === yourTrack,
    scores: [...state.scores],
    prevScores: [...state.prevScores],
    discardsOwed: spec.discards,

    hand: [...(state.hands[seat] ?? [])],
    unplayed: [...(state.pegRemaining[seat] ?? [])],
    legalPlays: legalPlaysFor(state, seat),

    opponents,

    crib: cribVisible(state) ? [...state.crib] : null,
    cribSize: state.crib.length,

    starter: state.starter,

    play: {
      turn: state.play.turn,
      total: state.play.total,
      sequence: state.play.sequence.map((p) => ({ ...p })),
      history: state.play.history.map((p) => ({ ...p })),
      goSaid: [...state.play.goSaid],
    },

    countIndex: state.countIndex,
    countLabel: currentCountLabel(state, names),
    counter: state.phase === "counting" ? counterSeat(state) : null,

    pending,
    isYourTurn,
    winnerSeat: state.winnerSeat,
    winnerTrack: state.winnerSeat === null ? null : trackOf(state, state.winnerSeat),
    prompt: buildPrompt(state, seat, isYourTurn, names),
  };
}

/** Seats sharing a track, for a client that wants to label the two sides. */
export { seatsOnTrack };

/**
 * Strips detail a viewer should not see from a log entry. Only the cards in
 * someone else's discard are secret; everything else in the log is public by
 * the time it is written.
 */
export function redactEvent(event: GameEvent, viewer: Seat): GameEvent {
  if (event.type === "discard" && event.seat !== viewer) {
    const { detail, ...rest } = event;
    void detail;
    return rest;
  }
  return event;
}
