import { getTableView } from "@/lib/server/table";
import { clientKey, fail, handleError, json, rateLimit } from "@/lib/server/http";

/**
 * The board as a television sees it. No session: a TV cannot sign in, and the
 * projection behind this carries nobody's hand, so the room code is all the
 * authority it needs — the same code the players themselves join with.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    // The code is the only credential here, so guessing at it should be slow.
    if (!rateLimit(clientKey(request, "tv"), 240, 60_000)) {
      return fail("Too many requests.", 429);
    }
    const table = await getTableView(code);
    if (!table) return fail("No game with that room code.", 404);
    return json(table);
  } catch (error) {
    return handleError(error);
  }
}
