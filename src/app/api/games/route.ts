import { requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { clientKey, fail, handleError, json, rateLimit } from "@/lib/server/http";
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

    const game = await createGameForUser(user);
    return json(
      {
        id: game.id,
        inviteCode: game.inviteCode,
        inviteUrl: `${env.appUrl}/join/${game.inviteCode}`,
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
