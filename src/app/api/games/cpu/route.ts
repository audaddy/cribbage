import { requireUser } from "@/lib/server/auth";
import { createCpuGame } from "@/lib/server/bot";
import { clientKey, fail, handleError, json, rateLimit } from "@/lib/server/http";

/** Opens a game against the computer, already seated and dealt. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(clientKey(request, "cpu"), 30, 60 * 60 * 1000)) {
      return fail("You have started a lot of games recently. Try again later.", 429);
    }
    const game = await createCpuGame(user);
    return json({ id: game.id }, 201);
  } catch (error) {
    return handleError(error);
  }
}
