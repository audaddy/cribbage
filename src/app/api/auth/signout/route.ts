import { clearSessionCookie } from "@/lib/server/auth";
import { handleError, json } from "@/lib/server/http";

export async function POST() {
  try {
    await clearSessionCookie();
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
