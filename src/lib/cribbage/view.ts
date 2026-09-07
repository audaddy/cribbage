/**
 * Per-seat projections of the game state.
 *
 * The server never ships a raw `GameState` to a client: it would contain the
 * opponent's hand, the crib and the undealt deck. `playerView` produces exactly
 * what one seat is entitled to see at this moment.
 */

import type { Card } from "./cards";
import { currentCountLabel, legalPlaysFor, otherSeat, pendingSeats } from "./engine";
import type { GameEvent, GameState, PlayedCard, Seat } from "./types";

export interface PlayerView {
  phase: GameState["phase"];
  handNumber: number;
  target: number;
  /** The viewing seat. */
  you: Seat;
  dealer: Seat;
  /** True when the viewer holds the deal, and therefore the crib. */
  youAreDealer: boolean;
  scores: [number, number];
  prevScores: [number, number];

  /** The viewer's cards: six before discarding, four after. */
  hand: Card[];
  /** Subset of `hand` not yet laid during the play. */
  unplayed: Card[];
  /** Cards the viewer may legally lay right now. */
  legalPlays: Card[];

  opponentCardCount: number;
  /** The opponent's kept hand, once the show has revealed it. */
  opponentHand: Card[] | null;
  /** The crib, once it is turned up for counting. */
  crib: Card[] | null;
  cribSize: number;

  starter: Card | null;
  discarded: [boolean, boolean];

  play: {
    turn: Seat;
    total: number;
    sequence: PlayedCard[];
    history: PlayedCard[];
    goSaid: [boolean, boolean];
  };

  countIndex: number;
  /** "non-dealer's hand" | "dealer's hand" | "crib" while counting. */
  countLabel: string | null;

  pending: Seat[];
  isYourTurn: boolean;
  winnerSeat: Seat | null;
  /** Short instruction rendered as the turn indicator. */
  prompt: string;
}

function opponentHandVisible(state: GameState, opponent: Seat): boolean {
  if (state.phase === "complete") return true;
  if (state.phase !== "counting") return false;
  // The non-dealer shows first (countIndex 0), the dealer second.
  return opponent === otherSeat(state.dealer) ? true : state.countIndex >= 1;
}

function cribVisible(state: GameState): boolean {
  return (
    state.phase === "complete" ||
    (state.phase === "counting" && state.countIndex >= 2)
  );
}

function buildPrompt(
  state: GameState,
  seat: Seat,
  isYourTurn: boolean,
  opponentName: string,
): string {
  if (state.phase === "awaiting_opponent") {
    return "Waiting for your opponent to accept the invite…";
  }
  if (state.phase === "complete") {
    return state.winnerSeat === seat ? "You won!" : `${opponentName} won.`;
  }
  if (!isYourTurn) {
    return `Waiting for ${opponentName}…`;
  }
  switch (state.phase) {
    case "discard":
      return state.dealer === seat
        ? "Discard two cards to your crib."
        : `Discard two cards to ${opponentName}'s crib.`;
    case "pegging":
      return `Play a card — the count is ${state.play.total}.`;
    case "counting":
      return state.countIndex === 2
        ? "Count your crib."
        : "Count your hand.";
    default:
      return "Your turn!";
  }
}

export function playerView(
  state: GameState,
  seat: Seat,
  opponentName = "your opponent",
): PlayerView {
  const opponent = otherSeat(seat);
  const pending = pendingSeats(state);
  const isYourTurn = pending.includes(seat);

  return {
    phase: state.phase,
    handNumber: state.handNumber,
    target: state.target,
    you: seat,
    dealer: state.dealer,
    youAreDealer: state.dealer === seat,
    scores: [...state.scores] as [number, number],
    prevScores: [...state.prevScores] as [number, number],

    hand: [...state.hands[seat]],
    unplayed: [...state.pegRemaining[seat]],
    legalPlays: legalPlaysFor(state, seat),

    opponentCardCount:
      state.phase === "pegging"
        ? state.pegRemaining[opponent].length
        : state.hands[opponent].length,
    opponentHand: opponentHandVisible(state, opponent)
      ? [...state.hands[opponent]]
      : null,
    crib: cribVisible(state) ? [...state.crib] : null,
    cribSize: state.crib.length,

    starter: state.starter,
    discarded: [...state.discarded] as [boolean, boolean],

    play: {
      turn: state.play.turn,
      total: state.play.total,
      sequence: state.play.sequence.map((p) => ({ ...p })),
      history: state.play.history.map((p) => ({ ...p })),
      goSaid: [...state.play.goSaid] as [boolean, boolean],
    },

    countIndex: state.countIndex,
    countLabel: currentCountLabel(state),

    pending,
    isYourTurn,
    winnerSeat: state.winnerSeat,
    prompt: buildPrompt(state, seat, isYourTurn, opponentName),
  };
}

/**
 * Strips detail a viewer should not see from a log entry. Only the cards in an
 * opponent's discard are secret; everything else in the log is public by the
 * time it is written.
 */
export function redactEvent(event: GameEvent, viewer: Seat): GameEvent {
  if (event.type === "discard" && event.seat !== viewer) {
    const { detail, ...rest } = event;
    void detail;
    return rest;
  }
  return event;
}
