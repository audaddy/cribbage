import { requireUser } from "@/lib/server/auth";
import { advanceBot } from "@/lib/server/bot";
import { getGameDetail } from "@/lib/server/games";
import { handleError, json } from "@/lib/server/http";

/**
 * Plays one computer move. The client calls this on a short delay so the
 * computer's turn is something you watch rather than something that has
 * already happened.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await advanceBot(id, user);
    return json(await getGameDetail(id, user.id));
  } catch (error) {
    return handleError(error);
  }
}
