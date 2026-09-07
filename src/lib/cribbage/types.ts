import type { Card } from "./cards";

/** Seat index. Seat 0 is the game's creator; seat 1 is the invited player. */
export type Seat = 0 | 1;

export type Phase =
  /** Game created, waiting for the second player to accept the invite. */
  | "awaiting_opponent"
  /** Six cards dealt to each player; both must discard two to the crib. */
  | "discard"
  /** Starter cut; players alternate laying cards up to 31. */
  | "pegging"
  /** The show: non-dealer hand, then dealer hand, then crib. */
  | "counting"
  /** Someone reached 121. */
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
  goSaid: [boolean, boolean];
  /** Last seat to lay a card in this sequence, for go / last-card points. */
  lastPlayer: Seat | null;
}

export interface GameState {
  /** Schema version of this payload, for forward migrations. */
  schema: 1;
  phase: Phase;
  /** Seat currently holding the deal. The non-dealer always leads the play. */
  dealer: Seat;
  scores: [number, number];
  /** Scores before the most recent award, so the board can draw a back peg. */
  prevScores: [number, number];
  /** Undealt remainder of the deck; the starter is cut from here. */
  deck: Card[];
  /** The six dealt cards before discarding, then the four kept cards. */
  hands: [Card[], Card[]];
  /** Kept cards not yet laid during the play. */
  pegRemaining: [Card[], Card[]];
  crib: Card[];
  starter: Card | null;
  /** True once that seat has committed its two crib cards. */
  discarded: [boolean, boolean];
  play: PlayState;
  /** 0 = non-dealer hand, 1 = dealer hand, 2 = crib. */
  countIndex: number;
  handNumber: number;
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
  | { type: "discard"; seat: Seat; cards: [Card, Card] }
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
