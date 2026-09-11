/**
 * Shapes exchanged between the API and the browser.
 *
 * Kept free of server imports so client components can depend on the contract
 * without dragging Prisma into the bundle.
 */

import type { GameEvent, PlayerView, Seat } from "./cribbage";

export interface GameSummary {
  id: string;
  status: string;
  phase: string;
  handNumber: number;
  yourSeat: Seat;
  yourScore: number;
  opponentScore: number;
  opponentName: string | null;
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

export interface GameDetail {
  id: string;
  status: string;
  version: number;
  you: { seat: Seat; name: string };
  opponent: { name: string } | null;
  /** True when the opponent is the computer, which the client paces. */
  opponentIsBot: boolean;
  view: PlayerView;
  log: LogEntry[];
  /** Recent table talk, oldest first. */
  reactions: ReactionEntry[];
  inviteUrl: string | null;
}

/** Request body accepted by POST /api/games/:id/move. */
export type MoveRequest =
  | { type: "discard"; cards: [string, string]; version?: number }
  | { type: "play"; card: string; version?: number }
  | { type: "count"; version?: number };
