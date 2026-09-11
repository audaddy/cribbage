/**
 * The television view of a game.
 *
 * Served to anyone holding the room code, with no session at all — a TV cannot
 * sign in. What makes that safe is the projection rather than the door: nobody
 * is "you" here, so there is no hand to hand out. See `spectatorView`.
 */

import type { GameEvent, Seat } from "@/lib/cribbage";
import { normalizeState, redactForSpectator, spectatorView } from "@/lib/cribbage";
import type { TableView } from "@/lib/api-types";
import { prisma } from "./db";
import { env } from "./env";
import { listReactions } from "./reactions";

/** How recently a TV must have asked before a phone treats it as live. */
export const TV_ACTIVE_MS = 90_000;

export async function getTableView(
  inviteCode: string,
  { heartbeat = true }: { heartbeat?: boolean } = {},
): Promise<TableView | null> {
  const code = inviteCode.toUpperCase();
  const game = await prisma.game.findUnique({
    where: { inviteCode: code },
    include: {
      player0: { select: { displayName: true } },
      player1: { select: { displayName: true } },
      player2: { select: { displayName: true } },
      player3: { select: { displayName: true } },
    },
  });
  if (!game) return null;

  const state = normalizeState(JSON.parse(game.state));
  const seated = [game.player0, game.player1, game.player2, game.player3];
  const names = Array.from(
    { length: state.seats },
    (_, seat) => seated[seat]?.displayName ?? "",
  );

  const [events, reactions] = await Promise.all([
    prisma.gameEvent
      .findMany({ where: { gameId: game.id }, orderBy: { seq: "desc" }, take: 60 })
      .then((rows) => rows.reverse()),
    listReactions(game.id),
  ]);

  // Tell the phones a screen is showing this, so they can stand down.
  if (heartbeat) {
    await prisma.game
      .update({ where: { id: game.id }, data: { tvSeenAt: new Date() } })
      .catch(() => undefined);
  }

  return {
    code,
    version: game.version,
    joinUrl: `${env.appUrl}/join/${code}`,
    seatsOpen: names.filter((name) => !name).length,
    view: spectatorView(state, names),
    log: events.map((event) => {
      const parsed: GameEvent = {
        type: event.type as GameEvent["type"],
        seat: event.seat as Seat | null,
        message: event.message,
        handNumber: event.handNumber,
        detail: event.detail ? JSON.parse(event.detail) : undefined,
      };
      const safe = redactForSpectator(parsed);
      return {
        seq: event.seq,
        seat: event.seat,
        type: event.type,
        message: event.message,
        points: event.points,
        handNumber: event.handNumber,
        detail: safe.detail ?? null,
        createdAt: event.createdAt.toISOString(),
      };
    }),
    reactions,
  };
}
