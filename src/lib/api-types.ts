/**
 * Shapes exchanged between the API and the browser.
 *
 * Kept free of server imports so client components can depend on the contract
 * without dragging Prisma into the bundle.
 */

import type { GameEvent, PlayerView, Seat, SpectatorView, Variant } from "./cribbage";

export interface GameSummary {
  id: string;
  status: string;
  phase: string;
  variant: Variant;
  seats: number;
  handNumber: number;
  yourSeat: Seat;
  /** Your score, or your partnership's. */
  yourScore: number;
  /** The best score against you, whoever holds it. */
  opponentScore: number;
  /** Everyone else at the table, comma-separated. */
  opponentName: string | null;
  /** Chairs nobody has taken yet. */
  seatsOpen: number;
  isYourTurn: boolean;
  winnerSeat: number | null;
  youWon: boolean | null;
  target: number;
  /** Present only to the creator of a game nobody has joined yet. */
  inviteCode: string | null;
  updatedAt: string;
}

export interface LogEntry {
  seq: number;
  seat: number | null;
  type: string;
  message: string;
  points: number | null;
  handNumber: number;
  detail: GameEvent["detail"] | null;
  createdAt: string;
}

/** One tap of table talk. The wording lives in the reaction catalogue. */
export interface ReactionEntry {
  id: string;
  seat: number;
  key: string;
  createdAt: string;
}

/** Somebody at the table, from the server's point of view. */
export interface TableSeat {
  seat: Seat;
  name: string | null;
  isBot: boolean;
}

/** How the same company has fared against each other over time. */
export interface RivalryRecord {
  /** Finished games between exactly these people. */
  played: number;
  standings: { userId: string; name: string; wins: number }[];
  /** Who took the most recent one. Both partners, in a partnership game. */
  lastWinnerIds: string[];
}

/** Everything a television is allowed to know about a game. */
export interface TableView {
  /** The room code, shown on screen for players to join with. */
  code: string;
  version: number;
  joinUrl: string;
  seatsOpen: number;
  view: SpectatorView;
  log: LogEntry[];
  reactions: ReactionEntry[];
}

export interface GameDetail {
  id: string;
  status: string;
  version: number;
  variant: Variant;
  you: { seat: Seat; name: string };
  /** Every chair in seating order, including empty ones. */
  table: TableSeat[];
  /**
   * The single other player, when there is exactly one. Kept for the heads-up
   * screens that have no use for a list.
   */
  opponent: { name: string } | null;
  /** True when the only opponent is the computer, which the client paces. */
  opponentIsBot: boolean;
  view: PlayerView;
  log: LogEntry[];
  /** Recent table talk, oldest first. */
  reactions: ReactionEntry[];
  /** The running score between these players, once they have finished one. */
  rivalry: RivalryRecord | null;
  /** The room code, for putting this game up on a television. */
  roomCode: string;
  /** True when a television has asked for this game in the last minute or so. */
  onTv: boolean;
  inviteUrl: string | null;
}

/** Request body accepted by POST /api/games/:id/move. */
export type MoveRequest =
  // One card in the three- and four-handed games, two heads-up.
  | { type: "discard"; cards: string[]; version?: number }
  | { type: "play"; card: string; version?: number }
  | { type: "count"; version?: number };
