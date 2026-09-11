import { requireUser } from "@/lib/server/auth";
import { getGameDetail } from "@/lib/server/games";
import { addReaction } from "@/lib/server/reactions";
import { clientKey, handleError, json, rateLimit, readJson } from "@/lib/server/http";

/** Says one thing across the board. Changes nothing about the game itself. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!rateLimit(clientKey(request, "react"), 30, 60_000)) {
      return json({ error: "Easy — let them play." }, 429);
    }
    const body = await readJson<{ key?: string }>(request);
    await addReaction(id, user, String(body.key ?? ""));
    return json(await getGameDetail(id, user.id));
  } catch (error) {
    return handleError(error);
  }
}
