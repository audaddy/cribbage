import { requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import {
  clientKey,
  fail,
  handleError,
  json,
  rateLimit,
  readJson,
} from "@/lib/server/http";
import { VARIANTS, type Variant } from "@/lib/cribbage";
import { createGameForUser, listGamesForUser } from "@/lib/server/games";

/** Every game the player is part of, newest activity first. */
export async function GET() {
  try {
    const user = await requireUser();
    return json({ games: await listGamesForUser(user.id) });
  } catch (error) {
    return handleError(error);
  }
}

/** Opens a new game and returns a shareable invite link. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(clientKey(request, "create"), 20, 60 * 60 * 1000)) {
      return fail("You have created a lot of games recently. Try again later.", 429);
    }

    // The shape of the table is fixed at creation: the deal, the counting
    // order and the number of chairs all follow from it.
    const body = await readJson<{ variant?: unknown }>(request).catch(() => ({}));
    const requested = String((body as { variant?: unknown }).variant ?? "two");
    if (!(requested in VARIANTS)) {
      return fail("Pick a two-handed, three-handed or partnership game.");
    }

    const game = await createGameForUser(user, requested as Variant);
    return json(
      {
        id: game.id,
        variant: game.variant,
        inviteCode: game.inviteCode,
        inviteUrl: `${env.appUrl}/join/${game.inviteCode}`,
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
