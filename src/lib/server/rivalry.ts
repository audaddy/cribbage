/**
 * The running score between the same people.
 *
 * Worked out from finished games rather than stored on a counter, so it is
 * right by construction and right retroactively: games played before anyone
 * thought to keep track are already in it. The key is the set of people at the
 * table, so your heads-up record against someone is separate from a table the
 * two of you shared with others.
 */

import type { Game } from "@prisma/client";
import { VARIANTS, type Variant, trackOf } from "@/lib/cribbage";
import type { RivalryRecord } from "@/lib/api-types";
import { prisma } from "./db";

/** Seat columns in order, trimmed to the seats this variant uses. */
function occupants(game: Pick<Game, "variant" | "player0Id" | "player1Id" | "player2Id" | "player3Id">): string[] {
  const ids = [game.player0Id, game.player1Id, game.player2Id, game.player3Id];
  const seats = VARIANTS[(game.variant as Variant) ?? "two"]?.seats ?? 2;
  return ids.slice(0, seats).filter((id): id is string => Boolean(id));
}

/** Order-independent identity for a table of people. */
function tableKey(ids: string[]): string {
  return [...ids].sort().join("|");
}

/**
 * Wins per person across every finished game with exactly these players.
 *
 * In a partnership game the win belongs to both partners, because it does.
 */
export async function rivalryFor(game: Game): Promise<RivalryRecord | null> {
  const ids = occupants(game);
  if (ids.length < 2) return null;
  const key = tableKey(ids);

  // Any finished game one of them played is a candidate; the table key then
  // narrows it to the games with this exact company.
  const candidates = await prisma.game.findMany({
    where: {
      status: "complete",
      winnerSeat: { not: null },
      OR: ids.map((id) => ({
        OR: [
          { player0Id: id },
          { player1Id: id },
          { player2Id: id },
          { player3Id: id },
        ],
      })),
    },
    select: {
      id: true,
      variant: true,
      winnerSeat: true,
      completedAt: true,
      player0Id: true,
      player1Id: true,
      player2Id: true,
      player3Id: true,
    },
    orderBy: { completedAt: "asc" },
  });

  const wins = new Map<string, number>(ids.map((id) => [id, 0]));
  let played = 0;
  let lastWinnerIds: string[] = [];

  for (const candidate of candidates) {
    const theirIds = occupants(candidate);
    if (tableKey(theirIds) !== key) continue;
    played += 1;

    const variant = (candidate.variant as Variant) ?? "two";
    const seatIds = [
      candidate.player0Id,
      candidate.player1Id,
      candidate.player2Id,
      candidate.player3Id,
    ];
    const winningTrack = trackOf({ variant }, candidate.winnerSeat!);
    const winners = seatIds
      .slice(0, VARIANTS[variant].seats)
      .map((id, seat) => ({ id, seat }))
      .filter(({ id, seat }) => id && trackOf({ variant }, seat) === winningTrack)
      .map(({ id }) => id!);

    for (const id of winners) wins.set(id, (wins.get(id) ?? 0) + 1);
    lastWinnerIds = winners;
  }

  if (played === 0) return { played: 0, standings: [], lastWinnerIds: [] };

  const people = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true },
  });
  const nameOf = new Map(people.map((person) => [person.id, person.displayName]));

  return {
    played,
    standings: ids
      .map((id) => ({
        userId: id,
        name: nameOf.get(id) ?? "Player",
        wins: wins.get(id) ?? 0,
      }))
      .sort((a, b) => b.wins - a.wins),
    lastWinnerIds,
  };
}
