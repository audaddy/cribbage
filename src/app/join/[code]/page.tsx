import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { GameAccessError, GameConflictError, acceptInvite } from "@/lib/server/games";

export const metadata = { title: "Join a game — Cribbage" };
export const dynamic = "force-dynamic";

/**
 * Invite links land here. Signing in first is required, so the destination is
 * carried through the magic link and the player is seated on their return.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/join/${encodeURIComponent(code)}`);

  let gameId: string | null = null;
  let joinError: string | null = null;
  try {
    gameId = (await acceptInvite(code, user)).id;
  } catch (error) {
    if (error instanceof GameAccessError || error instanceof GameConflictError) {
      joinError = error.message;
    } else {
      throw error;
    }
  }

  if (gameId) redirect(`/games/${gameId}`);

  return (
    <main className="shell shell--narrow stack">
      <div className="panel empty stack-sm">
        <h1>Cannot join</h1>
        <p className="small">{joinError}</p>
        <Link className="btn" href="/games">
          Back to your games
        </Link>
      </div>
    </main>
  );
}
