import { requireUser } from "@/lib/server/auth";
import { isValidCard } from "@/lib/cribbage";
import { fail, handleError, json, readJson } from "@/lib/server/http";
import { submitAction } from "@/lib/server/games";

interface MoveBody {
  type?: string;
  cards?: unknown;
  card?: unknown;
  version?: unknown;
}

/**
 * Applies one action. The body carries only the player's intent — the seat is
 * taken from the session, never from the request, so a player cannot move for
 * their opponent.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await readJson<MoveBody>(request);
    const version = typeof body.version === "number" ? body.version : undefined;

    switch (body.type) {
      case "discard": {
        const cards = body.cards;
        if (
          !Array.isArray(cards) ||
          cards.length !== 2 ||
          !cards.every((card) => isValidCard(card))
        ) {
          return fail("Select exactly two cards to discard.");
        }
        const result = await submitAction(
          id,
          user,
          { type: "discard", cards: cards as [string, string] },
          version,
        );
        return json(result.detail);
      }

      case "play": {
        if (!isValidCard(body.card)) return fail("Select a card to play.");
        const result = await submitAction(
          id,
          user,
          { type: "play", card: body.card },
          version,
        );
        return json(result.detail);
      }

      case "count": {
        const result = await submitAction(id, user, { type: "count" }, version);
        return json(result.detail);
      }

      default:
        return fail(`Unsupported action: ${String(body.type)}`);
    }
  } catch (error) {
    return handleError(error);
  }
}
