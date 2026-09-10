import { NextResponse } from "next/server";
import { consumeMagicLink, currentUser, setSessionCookie } from "@/lib/server/auth";
import { env } from "@/lib/server/env";

/** Redeems a magic link, starts the session and forwards the player on. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const next = url.searchParams.get("next");

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing", env.appUrl));
  }

  // A guest signing in by email keeps their account, and their games with it.
  const viewer = await currentUser();
  const user = await consumeMagicLink(token, viewer);
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=expired", env.appUrl));
  }

  await setSessionCookie(user.id);
  // Only same-origin paths are honoured, so the link cannot bounce elsewhere.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/games";
  return NextResponse.redirect(new URL(destination, env.appUrl));
}
