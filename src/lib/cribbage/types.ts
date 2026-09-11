import type { Card } from "./cards";

/**
 * Seat index, counting clockwise from the game's creator at seat 0.
 *
 * Two-handed games use seats 0–1, three-handed 0–2, partnership games 0–3 with
 * partners sitting opposite: 0 with 2, and 1 with 3.
 */
export type Seat = number;

/**
 * How many people are at the table, and whether they play as partnerships.
 *
 * These three are the only supported shapes because they are the only ones
 * with settled rules: heads-up, the three-handed game with its own card dealt
 * to the crib, and four in two partnerships.
 */
export type Variant = "two" | "three" | "teams";

export type Phase =
  /** Game created, waiting for the table to fill. */
  | "awaiting_opponent"
  /** Cards dealt; everyone owes the crib. */
  | "discard"
  /** Starter cut; play passes round the table up to 31. */
  | "pegging"
  /** The show: left of the dealer first, round to the dealer, then the crib. */
  | "counting"
  /** Someone reached the target. */
  | "complete";

/** One line of a scoring breakdown, e.g. "Fifteen two" worth 2. */
export interface ScoreItem {
  label: string;
  points: number;
  cards?: Card[];
}

export interface ScoreBreakdown {
  total: number;
  items: ScoreItem[];
}

export interface PlayedCard {
  seat: Seat;
  card: Card;
  /** Running total after this card was laid. */
  total: number;
}

export interface PlayState {
  /** Seat that must lay the next card. */
  turn: Seat;
  /** Running total for the current run up to 31. */
  total: number;
  /** Cards in the current up-to-31 sequence (cleared on 31 or a go). */
  sequence: PlayedCard[];
  /** Every card played this deal, in order. */
  history: PlayedCard[];
  /** Whether each seat has already declared "go" in this sequence. */
  goSaid: boolean[];
  /** Last seat to lay a card in this sequence, for go / last-card points. */
  lastPlayer: Seat | null;
}

export interface GameState {
  /**
   * Schema version of this payload.
   *
   * 1 was heads-up only, with two-element tuples and no `variant`. Those states
   * are still valid: `normalizeState` fills in what they predate, so a game in
   * progress survives the upgrade untouched.
   */
  schema: 1 | 2;
  variant: Variant;
  /** Seats at the table: 2, 3, or 4. Derived from `variant`. */
  seats: number;
  phase: Phase;
  /** Seat holding the deal. The seat to the dealer's left always leads. */
  dealer: Seat;
  /**
   * Scores, one per scoring track. Everyone keeps their own score except in a
   * partnership game, where the two partners share one — see `trackOf`.
   */
  scores: number[];
  /** Scores before the most recent award, so the board can draw a back peg. */
  prevScores: number[];
  /** Undealt remainder of the deck; the starter is cut from here. */
  deck: Card[];
  /** Dealt cards before discarding, then the four kept cards. */
  hands: Card[][];
  /** Kept cards not yet laid during the play. */
  pegRemaining: Card[][];
  crib: Card[];
  starter: Card | null;
  /** True once that seat has committed its crib card(s). */
  discarded: boolean[];
  play: PlayState;
  /**
   * Position in the show: 0 is the seat left of the dealer, counting round to
   * the dealer at `seats - 1`, and `seats` is the crib.
   */
  countIndex: number;
  handNumber: number;
  /** Winning seat. In a partnership game, one of the two winning partners. */
  winnerSeat: Seat | null;
  /** Target score; standard game is 121. */
  target: number;
}

export type GameEventType =
  | "deal"
  | "discard"
  | "cut"
  | "play"
  | "go"
  | "peg"
  | "show"
  | "win";

export interface GameEvent {
  type: GameEventType;
  /** Seat responsible, or null for engine/system events. */
  seat: Seat | null;
  message: string;
  points?: number;
  handNumber: number;
  detail?: {
    card?: Card;
    cards?: Card[];
    total?: number;
    breakdown?: ScoreItem[];
    starter?: Card;
  };
}

/**
 * Player-initiated actions. There is deliberately no "go" action: a player
 * with no legal card has no decision to make, so the engine declares the go on
 * their behalf and logs it. That keeps asynchronous games from stalling on a
 * forced move.
 */
export type Action =
  | { type: "join" }
  | { type: "discard"; seat: Seat; cards: Card[] }
  | { type: "play"; seat: Seat; card: Card }
  | { type: "count"; seat: Seat };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

/** Thrown for any move the rules reject. Surfaces to the API as a 400. */
export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalMoveError";
  }
}
