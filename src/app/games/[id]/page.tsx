import Link from "next/link";
import { redirect } from "next/navigation";
import type { GameDetail } from "@/lib/api-types";
import { currentUser } from "@/lib/server/auth";
import { GameAccessError, getGameDetail } from "@/lib/server/games";
import { GameClient } from "@/components/GameClient";

export const dynamic = "force-dynamic";

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/games/${encodeURIComponent(id)}`);

  // Rendered on the server so the board is there on first paint; the client
  // component takes over polling from this snapshot.
  let detail: GameDetail | null = null;
  let accessError: string | null = null;
  try {
    detail = await getGameDetail(id, user.id);
  } catch (error) {
    if (!(error instanceof GameAccessError)) throw error;
    accessError = error.message;
  }

  if (!detail) {
    return (
      <main className="shell shell--narrow stack">
        <div className="panel empty stack-sm">
          <h1>Not your game</h1>
          <p className="small">{accessError}</p>
          <Link className="btn" href="/games">
            Back to your games
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <GameClient initial={detail} />
    </main>
  );
}
