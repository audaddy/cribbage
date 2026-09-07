import { requireUser } from "@/lib/server/auth";
import { acceptInvite } from "@/lib/server/games";
import { fail, handleError, json, readJson } from "@/lib/server/http";

/** Accepts an invite code and seats the player. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { code } = await readJson<{ code?: string }>(request);
    const inviteCode = (code ?? "").trim().toUpperCase();

    if (!/^[A-Z0-9]{6,16}$/.test(inviteCode)) {
      return fail("That does not look like a valid invite code.");
    }

    const game = await acceptInvite(inviteCode, user);
    return json({ id: game.id });
  } catch (error) {
    return handleError(error);
  }
}
