/**
 * Saying something across the board.
 *
 * Kept well away from `submitAction`: a reaction writes one row, bumps no
 * version and reads no game state, so it can never lose a race with a move or
 * be rejected as stale. The worst a burst of table talk can do is fill a log.
 */

import type { User } from "@prisma/client";
import { reactionFor } from "@/lib/cribbage";
import type { ReactionEntry } from "@/lib/api-types";
import { prisma } from "./db";
import { GameAccessError, seatOf } from "./games";

/** How much recent talk a client is shown. */
const RECENT = 30;
/** Per seat, per game. Enough for banter, not enough to bury the log. */
const BURST = 6;
const BURST_WINDOW_MS = 60_000;

export async function addReaction(
  gameId: string,
  user: User,
  key: string,
): Promise<ReactionEntry> {
  if (!reactionFor(key)) throw new GameAccessError("Unknown reaction.");

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new GameAccessError("Game not found.");
  const seat = seatOf(game, user.id);
  if (seat === null) throw new GameAccessError("You are not a player in this game.");

  const recent = await prisma.reaction.count({
    where: {
      gameId,
      seat,
      createdAt: { gt: new Date(Date.now() - BURST_WINDOW_MS) },
    },
  });
  if (recent >= BURST) throw new GameAccessError("Easy — let them play.");

  const saved = await prisma.reaction.create({ data: { gameId, seat, key } });
  return { id: saved.id, seat, key, createdAt: saved.createdAt.toISOString() };
}

export async function listReactions(gameId: string): Promise<ReactionEntry[]> {
  const rows = await prisma.reaction.findMany({
    where: { gameId },
    orderBy: { createdAt: "desc" },
    take: RECENT,
  });
  return rows.reverse().map((row) => ({
    id: row.id,
    seat: row.seat,
    key: row.key,
    createdAt: row.createdAt.toISOString(),
  }));
}
