import { requireUser } from "@/lib/server/auth";
import { getGameDetail } from "@/lib/server/games";
import { handleError, json } from "@/lib/server/http";

/**
 * The full board from the caller's point of view. The opponent's hand, the
 * crib and the undealt deck are filtered out by `playerView`, so polling this
 * endpoint can never reveal hidden information.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return json(await getGameDetail(id, user.id));
  } catch (error) {
    return handleError(error);
  }
}
