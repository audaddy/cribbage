import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { fail, handleError, json, readJson } from "@/lib/server/http";

export async function GET() {
  try {
    const user = await requireUser();
    return json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    });
  } catch (error) {
    return handleError(error);
  }
}

/** Renames the current player. */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const { displayName } = await readJson<{ displayName?: string }>(request);
    const name = (displayName ?? "").trim();

    if (name.length < 2 || name.length > 40) {
      return fail("Display name must be between 2 and 40 characters.");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { displayName: name },
    });
    return json({ id: updated.id, displayName: updated.displayName });
  } catch (error) {
    return handleError(error);
  }
}
