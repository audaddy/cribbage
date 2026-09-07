/**
 * Game persistence and the move pipeline.
 *
 * Everything that mutates a game funnels through `submitAction`, which:
 *   1. resolves the caller's seat (and rejects spectators),
 *   2. runs the pure engine over the stored state,
 *   3. writes the new state, the denormalized columns and the log in one
 *      transaction guarded by an optimistic version check,
 *   4. fires the turn-notification hook.
 */

import { randomBytes } from "node:crypto";
import type { Game, User } from "@prisma/client";
import {
  type Action,
  type Card,
  type GameEvent,
  type GameState,
  IllegalMoveError,
  type Seat,
  TARGET_SCORE,
  applyAction,
  createGame,
  pendingSeats,
  playerView,
  redactEvent,
} from "@/lib/cribbage";
import type { GameDetail, GameSummary } from "@/lib/api-types";
import { prisma } from "./db";
import { env } from "./env";
import { notify } from "./notify";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1

export class GameAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameAccessError";
  }
}

export class GameConflictError extends Error {
  constructor(message = "This game changed while you were moving. Reload and try again.") {
    super(message);
    this.name = "GameConflictError";
  }
}

export { IllegalMoveError };
export type { GameDetail, GameSummary, LogEntry } from "@/lib/api-types";

// --- helpers ---------------------------------------------------------------

function newInviteCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
}

function parseState(game: Game): GameState {
  return JSON.parse(game.state) as GameState;
}

function maskOf(state: GameState): number {
  return pendingSeats(state).reduce<number>((mask, seat) => mask | (1 << seat), 0);
}

export function seatOf(game: Game, userId: string): Seat | null {
  if (game.player0Id === userId) return 0;
  if (game.player1Id === userId) return 1;
  return null;
}

function requireSeat(game: Game, userId: string): Seat {
  const seat = seatOf(game, userId);
  if (seat === null) throw new GameAccessError("You are not a player in this game.");
  return seat;
}

/** Columns derived from the engine state, kept in sync on every write. */
function projection(state: GameState) {
  return {
    phase: state.phase,
    status:
      state.phase === "awaiting_opponent"
        ? "awaiting_opponent"
        : state.phase === "complete"
          ? "complete"
          : "active",
    pendingMask: maskOf(state),
    dealerSeat: state.dealer,
    score0: state.scores[0],
    score1: state.scores[1],
    handNumber: state.handNumber,
    winnerSeat: state.winnerSeat,
    state: JSON.stringify(state),
  };
}

type GameWithPlayers = Game & {
  player0: Pick<User, "id" | "displayName">;
  player1: Pick<User, "id" | "displayName"> | null;
};

const withPlayers = {
  player0: { select: { id: true, displayName: true } },
  player1: { select: { id: true, displayName: true } },
} as const;

function namesOf(game: GameWithPlayers): [string, string] {
  return [game.player0.displayName, game.player1?.displayName ?? "Opponent"];
}

// --- reads -----------------------------------------------------------------

export async function listGamesForUser(userId: string): Promise<GameSummary[]> {
  const games = await prisma.game.findMany({
    where: { OR: [{ player0Id: userId }, { player1Id: userId }] },
    include: withPlayers,
    orderBy: [{ status: "asc" }, { lastMoveAt: "desc" }],
  });

  return games.map((game) => {
    const seat = seatOf(game, userId)!;
    const opponent = seat === 0 ? game.player1 : game.player0;
    return {
      id: game.id,
      status: game.status,
      phase: game.phase,
      handNumber: game.handNumber,
      yourSeat: seat,
      yourScore: seat === 0 ? game.score0 : game.score1,
      opponentScore: seat === 0 ? game.score1 : game.score0,
      opponentName: opponent?.displayName ?? null,
      isYourTurn: (game.pendingMask & (1 << seat)) !== 0,
      winnerSeat: game.winnerSeat,
      youWon: game.winnerSeat === null ? null : game.winnerSeat === seat,
      target: TARGET_SCORE,
      // Only the creator needs the invite code, and only while it is open.
      inviteCode:
        game.status === "awaiting_opponent" && game.player0Id === userId
          ? game.inviteCode
          : null,
      updatedAt: game.lastMoveAt.toISOString(),
    };
  });
}

export async function getGameDetail(
  gameId: string,
  userId: string,
): Promise<GameDetail> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: withPlayers,
  });
  if (!game) throw new GameAccessError("Game not found.");

  const seat = requireSeat(game, userId);
  const state = parseState(game);
  const names = namesOf(game);
  const opponentName = names[seat === 0 ? 1 : 0];

  // Take the most recent slice, not the oldest: a long game would otherwise
  // show only its opening hands and hide everything that just happened.
  const events = (
    await prisma.gameEvent.findMany({
      where: { gameId },
      orderBy: { seq: "desc" },
      take: 400,
    })
  ).reverse();

  return {
    id: game.id,
    status: game.status,
    version: game.version,
    you: { seat, name: names[seat] },
    opponent: game.player1 ? { name: opponentName } : null,
    view: playerView(state, seat, opponentName),
    log: events.map((event) => {
      const parsed: GameEvent = {
        type: event.type as GameEvent["type"],
        seat: event.seat as Seat | null,
        message: event.message,
        handNumber: event.handNumber,
        detail: event.detail ? JSON.parse(event.detail) : undefined,
      };
      const redacted = redactEvent(parsed, seat);
      return {
        seq: event.seq,
        seat: event.seat,
        type: event.type,
        message: event.message,
        points: event.points,
        handNumber: event.handNumber,
        detail: redacted.detail ?? null,
        createdAt: event.createdAt.toISOString(),
      };
    }),
    inviteUrl:
      game.status === "awaiting_opponent" && game.player0Id === userId
        ? `${env.appUrl}/join/${game.inviteCode}`
        : null,
  };
}

// --- writes ----------------------------------------------------------------

export interface InviteSummary {
  gameId: string;
  hostName: string;
  isFull: boolean;
  status: string;
  /** Seat the viewer already holds in this game, if any. */
  yourSeat: Seat | null;
}

/**
 * Public detail about an invite, safe to render to someone who is not signed
 * in — it is what the join page shows before anyone is seated.
 */
export async function getInviteSummary(
  inviteCode: string,
  userId?: string,
): Promise<InviteSummary | null> {
  const game = await prisma.game.findUnique({
    where: { inviteCode: inviteCode.toUpperCase() },
    include: withPlayers,
  });
  if (!game) return null;

  return {
    gameId: game.id,
    hostName: game.player0.displayName,
    isFull: game.player1Id !== null,
    status: game.status,
    yourSeat: userId ? seatOf(game, userId) : null,
  };
}

export async function createGameForUser(user: User): Promise<Game> {
  const state = createGame();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.game.create({
        data: {
          inviteCode: newInviteCode(),
          player0Id: user.id,
          ...projection(state),
        },
      });
    } catch (error) {
      // Retry only on an invite-code collision.
      if (attempt === 4) throw error;
    }
  }
  throw new Error("Could not allocate an invite code.");
}

/**
 * Accepts an invite. Idempotent for the seats already in the game: opening
 * your own invite link twice just takes you back to the board.
 */
export async function acceptInvite(inviteCode: string, user: User): Promise<Game> {
  const game = await prisma.game.findUnique({
    where: { inviteCode: inviteCode.toUpperCase() },
    include: withPlayers,
  });
  if (!game) throw new GameAccessError("That invite link is not valid.");
  if (seatOf(game, user.id) !== null) return game;
  if (game.player1Id) throw new GameAccessError("This game already has two players.");

  const names: [string, string] = [game.player0.displayName, user.displayName];
  const { state, events } = applyAction(parseState(game), { type: "join" }, { names });

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.game.updateMany({
      where: { id: game.id, player1Id: null, version: game.version },
      data: {
        player1Id: user.id,
        version: game.version + 1,
        lastMoveAt: new Date(),
        ...projection(state),
      },
    });
    if (claimed.count !== 1) throw new GameConflictError("Someone else joined first.");

    await writeEvents(tx, game.id, 0, events);
    return tx.game.findUniqueOrThrow({ where: { id: game.id }, include: withPlayers });
  });

  const creator = await prisma.user.findUnique({ where: { id: game.player0Id } });
  if (creator) {
    await notify({
      game: updated,
      recipient: creator,
      opponent: user,
      type: "invite_accepted",
      summary: `${user.displayName} accepted your invite. The game is on.`,
    }).catch(() => undefined);
  }

  return updated;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function writeEvents(
  tx: Tx,
  gameId: string,
  startSeq: number,
  events: GameEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.gameEvent.createMany({
    data: events.map((event, index) => ({
      gameId,
      seq: startSeq + index,
      seat: event.seat,
      type: event.type,
      message: event.message,
      points: event.points ?? null,
      handNumber: event.handNumber,
      detail: event.detail ? JSON.stringify(event.detail) : null,
    })),
  });
}

export interface MoveResult {
  detail: GameDetail;
}

/**
 * What a client is allowed to ask for. Deliberately seat-free: the seat is
 * derived from the session so a request can never move for the opponent.
 */
export type ClientAction =
  | { type: "discard"; cards: [Card, Card] }
  | { type: "play"; card: Card }
  | { type: "count" };

/**
 * Applies one player action.
 *
 * `expectedVersion` (optional) makes the call idempotent against double
 * submits: if the client's view is stale the move is rejected rather than
 * applied to a state the player never saw.
 */
export async function submitAction(
  gameId: string,
  user: User,
  action: ClientAction,
  expectedVersion?: number,
): Promise<MoveResult> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: withPlayers,
  });
  if (!game) throw new GameAccessError("Game not found.");

  const seat = requireSeat(game, user.id);
  if (expectedVersion !== undefined && expectedVersion !== game.version) {
    throw new GameConflictError();
  }

  const before = parseState(game);
  const names = namesOf(game);
  const { state, events } = applyAction(
    before,
    { ...action, seat } as Action,
    { names },
  );

  const lastEvent = await prisma.gameEvent.findFirst({
    where: { gameId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const startSeq = (lastEvent?.seq ?? -1) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const applied = await tx.game.updateMany({
      where: { id: gameId, version: game.version },
      data: {
        version: game.version + 1,
        lastMoveAt: new Date(),
        completedAt: state.phase === "complete" ? new Date() : null,
        ...projection(state),
      },
    });
    if (applied.count !== 1) throw new GameConflictError();

    await writeEvents(tx, gameId, startSeq, events);
    return tx.game.findUniqueOrThrow({ where: { id: gameId }, include: withPlayers });
  });

  await dispatchTurnNotification(updated, before, state, seat).catch(() => undefined);

  return { detail: await getGameDetail(gameId, user.id) };
}

/** Notifies the opponent when the move handed them the turn, or ended the game. */
async function dispatchTurnNotification(
  game: GameWithPlayers,
  before: GameState,
  after: GameState,
  actorSeat: Seat,
): Promise<void> {
  const players = [game.player0, game.player1];
  const opponentSeat = (1 - actorSeat) as Seat;
  const opponentRow = players[opponentSeat];
  if (!opponentRow) return;

  const opponent = await prisma.user.findUnique({ where: { id: opponentRow.id } });
  const actor = await prisma.user.findUnique({ where: { id: players[actorSeat]!.id } });
  if (!opponent || !actor) return;

  if (after.phase === "complete") {
    await notify({
      game,
      recipient: opponent,
      opponent: actor,
      type: "game_over",
      summary:
        after.winnerSeat === opponentSeat
          ? `You won ${after.scores[opponentSeat]}–${after.scores[actorSeat]}.`
          : `${actor.displayName} won ${after.scores[actorSeat]}–${after.scores[opponentSeat]}.`,
    });
    return;
  }

  const wasWaiting = pendingSeats(before).includes(opponentSeat);
  const nowPending = pendingSeats(after).includes(opponentSeat);
  if (nowPending && !wasWaiting) {
    await notify({
      game,
      recipient: opponent,
      opponent: actor,
      type: "your_turn",
      summary: `It is your turn against ${actor.displayName}. The score is ${after.scores[opponentSeat]}–${after.scores[actorSeat]}.`,
    });
  }
}
