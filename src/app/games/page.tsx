import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { listGamesForUser } from "@/lib/server/games";
import { LobbyActions } from "@/components/LobbyActions";
import { NameEditor } from "@/components/NameEditor";
import { PlayingCard } from "@/components/PlayingCard";

export const metadata = { title: "Your games — Cribbage" };
export const dynamic = "force-dynamic";

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function GamesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/games");

  const games = await listGamesForUser(user.id);
  const yourTurn = games.filter((game) => game.isYourTurn);
  const waiting = games.filter((game) => !game.isYourTurn && game.status !== "complete");
  const finished = games.filter((game) => game.status === "complete");

  return (
    <main className="shell stack">
      <div className="row-wrap">
        <div className="stack-sm" style={{ minWidth: 0 }}>
          <h1>Your games</h1>
          <NameEditor name={user.displayName} isGuest={user.isGuest} />
        </div>
      </div>

      <LobbyActions isGuest={user.isGuest} />

      {games.length === 0 && (
        <div className="empty-table stack-sm">
          <div className="hand hand--tiny" aria-hidden="true">
            {["6C", "7D", "8S"].map((card, index) => (
              <span
                key={card}
                className="hand-card hand-card--dealing"
                style={
                  {
                    "--angle": `${(index - 1) * 9}deg`,
                    "--arc": `${(index - 1) ** 2 * 4}px`,
                    "--i": index,
                  } as React.CSSProperties
                }
              >
                <PlayingCard card={card} size="sm" />
              </span>
            ))}
          </div>
          <h2>No games yet.</h2>
          <p className="small" style={{ opacity: 0.82 }}>
            Press <strong>New game</strong>, then text the link to whoever you
            want to play. They tap it and the first hand is dealt.
          </p>
        </div>
      )}

      <GameSection title="Your turn" games={yourTurn} />
      <GameSection title="Waiting on your opponent" games={waiting} />
      <GameSection title="Finished" games={finished} />
    </main>
  );
}

function GameSection({
  title,
  games,
}: {
  title: string;
  games: Awaited<ReturnType<typeof listGamesForUser>>;
}) {
  if (games.length === 0) return null;
  return (
    <section className="stack-sm">
      <h2 className="panel-title">{title}</h2>
      <div className="game-list">
        {games.map((game) => (
          <Link
            key={game.id}
            href={`/games/${game.id}`}
            className={`game-card${game.isYourTurn ? " game-card--turn" : ""}`}
          >
            <div className="stack-sm" style={{ gap: 3, minWidth: 0, flex: 1 }}>
              <span className="score-name">
                {game.opponentName ?? "Waiting for an opponent"}
              </span>
              <span className="tiny muted">
                {game.status === "awaiting_opponent"
                  ? game.inviteCode
                    ? `Invite code ${game.inviteCode}`
                    : "Not started"
                  : game.status === "complete"
                    ? `Finished · ${relative(game.updatedAt)}`
                    : `Hand ${game.handNumber} · ${relative(game.updatedAt)}`}
              </span>
              {game.status !== "awaiting_opponent" && (
                // A cribbage board in miniature: how far apart the pegs are.
                <span className="mini-track" aria-hidden="true">
                  <span
                    className="mini-peg"
                    style={{
                      left: `${Math.min(game.opponentScore / game.target, 1) * 100}%`,
                      background: game.yourSeat === 0 ? "var(--p1)" : "var(--p0)",
                    }}
                  />
                  <span
                    className="mini-peg"
                    style={{
                      left: `${Math.min(game.yourScore / game.target, 1) * 100}%`,
                      background: game.yourSeat === 0 ? "var(--p0)" : "var(--p1)",
                    }}
                  />
                </span>
              )}
            </div>

            <span className="scoreline">
              {game.yourScore}
              <span className="muted"> – </span>
              {game.opponentScore}
            </span>

            {game.youWon !== null ? (
              <span className={`tag${game.youWon ? " tag--won" : ""}`}>
                {game.youWon ? "Won" : "Lost"}
              </span>
            ) : game.isYourTurn ? (
              <span className="tag tag--turn">Your turn</span>
            ) : (
              <span className="tag">Waiting</span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
