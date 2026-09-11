import { requireUser } from "@/lib/server/auth";
import { createRematch } from "@/lib/server/games";
import { clientKey, fail, handleError, json, rateLimit } from "@/lib/server/http";

/** Deals the next game between the same people. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!rateLimit(clientKey(request, "rematch"), 30, 60 * 60 * 1000)) {
      return fail("You have started a lot of games recently. Try again later.", 429);
    }
    const game = await createRematch(id, user);
    return json({ id: game.id }, 201);
  } catch (error) {
    return handleError(error);
  }
}
