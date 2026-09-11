import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { listGamesForUser } from "@/lib/server/games";
import { LobbyActions } from "@/components/LobbyActions";
import { NameEditor } from "@/components/NameEditor";
import { PlayingCard } from "@/components/PlayingCard";
import { GameSection } from "@/components/GameSection";

export const metadata = { title: "Your games — Cribbage" };
export const dynamic = "force-dynamic";

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
