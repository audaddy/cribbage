/**
 * Seating the computer opponent.
 *
 * The bot is an ordinary User row with `isBot` set, so every existing rule
 * applies to it unchanged: it holds a seat, its moves go through
 * `submitAction`, its actions land in the log, and the hidden-information
 * projection stops it seeing anything a human could not. Nothing in the engine
 * or the API knows it is a machine.
 */

import type { Game, User } from "@prisma/client";
import { chooseAction } from "@/lib/cribbage/bot";
import { prisma } from "./db";
import {
  GameAccessError,
  acceptInvite,
  createGameForUser,
  seatOf,
  submitAction,
} from "./games";

const BOT_NAME = "The Computer";

/** The single shared bot account, created on first use. */
export async function botUser(): Promise<User> {
  const existing = await prisma.user.findFirst({ where: { isBot: true } });
  if (existing) return existing;
  return prisma.user.create({
    data: { displayName: BOT_NAME, isGuest: false, isBot: true },
  });
}

/** Opens a game already seated by the computer, so play starts immediately. */
export async function createCpuGame(user: User): Promise<Game> {
  const game = await createGameForUser(user);
  const bot = await botUser();
  return acceptInvite(game.inviteCode, bot);
}

/**
 * Plays one computer move, if it is genuinely the computer's turn.
 *
 * Deliberately one action per call rather than a loop: the client paces these,
 * so each move arrives as its own state change and animates on its own instead
 * of a whole turn appearing at once.
 */
export async function advanceBot(gameId: string, caller: User): Promise<boolean> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { player0: true, player1: true },
  });
  if (!game) throw new GameAccessError("Game not found.");
  // Only someone at this table may nudge it along.
  if (seatOf(game, caller.id) === null) {
    throw new GameAccessError("You are not a player in this game.");
  }

  const bot = [game.player0, game.player1].find((p) => p?.isBot);
  if (!bot) return false;

  const seat = seatOf(game, bot.id);
  if (seat === null) return false;

  const state = JSON.parse(game.state);
  const action = chooseAction(state, seat);
  if (!action) return false;

  await submitAction(gameId, bot, action, game.version);
  return true;
}
