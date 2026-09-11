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
  VARIANTS,
  type Variant,
  applyAction,
  createGame,
  normalizeState,
  pendingSeats,
  playerView,
  redactEvent,
  trackCount,
  trackOf,
} from "@/lib/cribbage";
import type { GameDetail, GameSummary } from "@/lib/api-types";
import { prisma } from "./db";
import { env } from "./env";
import { notify } from "./notify";
import { listReactions } from "./reactions";
import { rivalryFor } from "./rivalry";
import { TV_ACTIVE_MS } from "./table";

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
  return normalizeState(JSON.parse(game.state) as GameState);
}

function maskOf(state: GameState): number {
  return pendingSeats(state).reduce<number>((mask, seat) => mask | (1 << seat), 0);
}

/** Seat columns in seating order, so a seat is an index into this list. */
function seatIds(game: Game): (string | null)[] {
  return [game.player0Id, game.player1Id, game.player2Id, game.player3Id];
}

export function seatOf(game: Game, userId: string): Seat | null {
  const seat = seatIds(game).indexOf(userId);
  return seat === -1 ? null : seat;
}

/** How many seats this game's variant asks for. */
export function seatCount(game: Pick<Game, "variant">): number {
  return VARIANTS[game.variant as Variant]?.seats ?? 2;
}

/** The lowest seat nobody holds, or null when the table is full. */
function firstFreeSeat(game: Game): Seat | null {
  const ids = seatIds(game);
  for (let seat = 1; seat < seatCount(game); seat += 1) {
    if (!ids[seat]) return seat;
  }
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
    score0: state.scores[0] ?? 0,
    score1: state.scores[1] ?? 0,
    score2: state.scores[2] ?? 0,
    handNumber: state.handNumber,
    winnerSeat: state.winnerSeat,
    state: JSON.stringify(state),
  };
}

type SeatUser = Pick<User, "id" | "displayName" | "isBot">;

type GameWithPlayers = Game & {
  player0: SeatUser;
  player1: SeatUser | null;
  player2: SeatUser | null;
  player3: SeatUser | null;
};

const seatSelect = { select: { id: true, displayName: true, isBot: true } } as const;

const withPlayers = {
  player0: seatSelect,
  player1: seatSelect,
  player2: seatSelect,
  player3: seatSelect,
} as const;

/** Display names by seat, with placeholders for seats nobody holds yet. */
function namesOf(game: GameWithPlayers): string[] {
  const seated = [game.player0, game.player1, game.player2, game.player3];
  return Array.from(
    { length: seatCount(game) },
    (_, seat) => seated[seat]?.displayName ?? `Player ${seat + 1}`,
  );
}

// --- reads -----------------------------------------------------------------

export async function listGamesForUser(userId: string): Promise<GameSummary[]> {
  const games = await prisma.game.findMany({
    where: {
      OR: [
        { player0Id: userId },
        { player1Id: userId },
        { player2Id: userId },
        { player3Id: userId },
      ],
      // Games this player has cleared off their own list.
      hiddenBy: { none: { userId } },
    },
    include: withPlayers,
    orderBy: [{ status: "asc" }, { lastMoveAt: "desc" }],
  });

  return games.map((game) => {
    const seat = seatOf(game, userId)!;
    const variant = (game.variant as Variant) ?? "two";
    const names = namesOf(game);
    const seated = [game.player0, game.player1, game.player2, game.player3];
    const track = trackOf({ variant }, seat);
    const scores = [game.score0, game.score1, game.score2];
    // Everyone at the table but you, which is one name heads-up and a list
    // otherwise. Partners are named too — you want to know who you are with.
    const others = names
      .map((name, other) => ({ name, other }))
      .filter(({ other }) => other !== seat && seated[other])
      .map(({ name }) => name);
    const bestOther = Math.max(
      0,
      ...scores
        .map((score, index) => ({ score, index }))
        .filter(({ index }) => index !== track && index < trackCount({ variant }))
        .map(({ score }) => score),
    );
    return {
      id: game.id,
      status: game.status,
      phase: game.phase,
      variant,
      seats: VARIANTS[variant].seats,
      handNumber: game.handNumber,
      yourSeat: seat,
      yourScore: scores[track] ?? 0,
      opponentScore: bestOther,
      opponentName: others.length > 0 ? others.join(", ") : null,
      /** Seats still waiting on somebody to take them. */
      seatsOpen:
        VARIANTS[variant].seats - seated.filter((player, index) => player && index < VARIANTS[variant].seats).length,
      isYourTurn: (game.pendingMask & (1 << seat)) !== 0,
      winnerSeat: game.winnerSeat,
      youWon:
        game.winnerSeat === null
          ? null
          : trackOf({ variant }, game.winnerSeat) === track,
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

  // Take the most recent slice, not the oldest: a long game would otherwise
  // show only its opening hands and hide everything that just happened.
  const [events, reactions, rivalry] = await Promise.all([
    prisma.gameEvent
      .findMany({ where: { gameId }, orderBy: { seq: "desc" }, take: 400 })
      .then((rows) => rows.reverse()),
    listReactions(gameId),
    // Only worth the query once a table is full: an open invite has no history.
    game.player1Id ? rivalryFor(game) : Promise.resolve(null),
  ]);

  const seated = [game.player0, game.player1, game.player2, game.player3];
  const table = Array.from({ length: seatCount(game) }, (_, index) => ({
    seat: index,
    name: seated[index]?.displayName ?? null,
    isBot: seated[index]?.isBot ?? false,
  }));
  const others = table.filter((entry) => entry.seat !== seat && entry.name);

  return {
    id: game.id,
    status: game.status,
    version: game.version,
    variant: (game.variant as Variant) ?? "two",
    you: { seat, name: names[seat]! },
    table,
    opponent: others.length === 1 ? { name: others[0]!.name! } : null,
    // Only meaningful heads-up: the client paces a lone computer opponent.
    opponentIsBot: others.length === 1 && others[0]!.isBot,
    view: playerView(state, seat, names),
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
    reactions,
    rivalry,
    roomCode: game.inviteCode,
    onTv:
      game.tvSeenAt !== null &&
      Date.now() - game.tvSeenAt.getTime() < TV_ACTIVE_MS,
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
  variant: Variant;
  seats: number;
  seatsOpen: number;
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

  const variant = (game.variant as Variant) ?? "two";
  return {
    gameId: game.id,
    hostName: game.player0.displayName,
    isFull: firstFreeSeat(game) === null,
    variant,
    seats: VARIANTS[variant].seats,
    /** Chairs still open, including the one this visitor would take. */
    seatsOpen: [game.player1Id, game.player2Id, game.player3Id]
      .slice(0, VARIANTS[variant].seats - 1)
      .filter((id) => !id).length,
    status: game.status,
    yourSeat: userId ? seatOf(game, userId) : null,
  };
}

export async function createGameForUser(
  user: User,
  variant: Variant = "two",
): Promise<Game> {
  const state = createGame(variant);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.game.create({
        data: {
          inviteCode: newInviteCode(),
          player0Id: user.id,
          variant,
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

  const seat = firstFreeSeat(game);
  if (seat === null) throw new GameAccessError("This game is already full.");

  const total = seatCount(game);
  const names = namesOf(game);
  names[seat] = user.displayName;

  // The cards are only dealt once every chair is taken. Until then the join
  // just claims a seat, so a four-handed game can fill up over an afternoon.
  const last = seat === total - 1;
  const { state, events } = last
    ? applyAction(parseState(game), { type: "join" }, { names })
    : { state: parseState(game), events: [] as GameEvent[] };

  const column = (["player0Id", "player1Id", "player2Id", "player3Id"] as const)[seat]!;

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.game.updateMany({
      // The seat must still be empty: two people opening the same link at once
      // must not land in the same chair.
      where: { id: game.id, [column]: null, version: game.version },
      data: {
        [column]: user.id,
        version: game.version + 1,
        lastMoveAt: new Date(),
        ...projection(state),
      },
    });
    if (claimed.count !== 1) throw new GameConflictError("Someone else took that seat.");

    if (events.length > 0) await writeEvents(tx, game.id, 0, events);
    return tx.game.findUniqueOrThrow({ where: { id: game.id }, include: withPlayers });
  });

  // Everyone already at the table hears that somebody sat down.
  const seatedIds = [game.player0Id, game.player1Id, game.player2Id, game.player3Id]
    .slice(0, total)
    .filter((id): id is string => Boolean(id) && id !== user.id);
  const seated = await prisma.user.findMany({ where: { id: { in: seatedIds } } });
  const summary = last
    ? `${user.displayName} joined. The game is on.`
    : `${user.displayName} joined. Waiting on ${total - seatedIds.length - 1} more.`;
  await Promise.all(
    seated.map((recipient) =>
      notify({
        game: updated,
        recipient,
        opponent: user,
        type: "invite_accepted",
        summary,
      }).catch(() => undefined),
    ),
  );

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
  // One card in the three- and four-handed games, two heads-up.
  | { type: "discard"; cards: Card[] }
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

/**
 * Clears a game off one player's lobby.
 *
 * Hiding rather than deleting, because the other players are still in that
 * game: one person tidying their list must not take it away from everybody
 * else. Once every human at the table has hidden it — or when nobody else was
 * ever there — the row and its history go for good.
 */
export async function hideGame(gameId: string, user: User): Promise<void> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: withPlayers,
  });
  if (!game) throw new GameAccessError("Game not found.");
  if (seatOf(game, user.id) === null) {
    throw new GameAccessError("You are not a player in this game.");
  }

  await prisma.gameHidden.upsert({
    where: { gameId_userId: { gameId, userId: user.id } },
    update: {},
    create: { gameId, userId: user.id },
  });

  // Everyone whose opinion counts: real people still holding a seat. A game
  // against the computer, or an invite nobody took, has nobody else to ask.
  const humans = [game.player0, game.player1, game.player2, game.player3]
    .slice(0, seatCount(game))
    .filter((player): player is SeatUser => Boolean(player) && !player!.isBot)
    .map((player) => player.id);

  const hidden = await prisma.gameHidden.findMany({
    where: { gameId },
    select: { userId: true },
  });
  const hiddenIds = new Set(hidden.map((row) => row.userId));

  if (humans.every((id) => hiddenIds.has(id))) {
    // Events, reactions and hide markers all cascade from the game row.
    await prisma.game.delete({ where: { id: gameId } });
  }
}

/**
 * Starts the next game between the same people.
 *
 * Everyone is already seated, so there is no invite to send and no waiting:
 * the cards are dealt as the game is created. The previous game is left alone
 * — it is what the running score is counted from.
 */
export async function createRematch(gameId: string, user: User): Promise<Game> {
  const previous = await prisma.game.findUnique({
    where: { id: gameId },
    include: withPlayers,
  });
  if (!previous) throw new GameAccessError("Game not found.");
  if (seatOf(previous, user.id) === null) {
    throw new GameAccessError("You are not a player in this game.");
  }
  if (previous.status !== "complete") {
    throw new GameAccessError("Finish this game first.");
  }

  const variant = (previous.variant as Variant) ?? "two";
  const seats = VARIANTS[variant].seats;
  const ids = [
    previous.player0Id,
    previous.player1Id,
    previous.player2Id,
    previous.player3Id,
  ].slice(0, seats);
  if (ids.some((id) => !id)) {
    throw new GameAccessError("That game never filled up.");
  }

  const names = namesOf(previous);
  // The loser deals the next game, as they would at a table.
  const state = createGame(variant);
  const { state: dealt, events } = applyAction(state, { type: "join" }, { names });

  const created = await prisma.game.create({
    data: {
      inviteCode: newInviteCode(),
      variant,
      player0Id: ids[0]!,
      player1Id: ids[1] ?? null,
      player2Id: ids[2] ?? null,
      player3Id: ids[3] ?? null,
      ...projection(dealt),
    },
  });
  await prisma.$transaction((tx) => writeEvents(tx, created.id, 0, events));

  // Everybody else finds out there is a new game waiting on them.
  const others = await prisma.user.findMany({
    where: { id: { in: ids.filter((id): id is string => Boolean(id) && id !== user.id) } },
  });
  await Promise.all(
    others.map((recipient) =>
      notify({
        game: created,
        recipient,
        opponent: user,
        type: "invite_accepted",
        summary: `${user.displayName} wants a rematch. Your move.`,
      }).catch(() => undefined),
    ),
  );

  return created;
}
