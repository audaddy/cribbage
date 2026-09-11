"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { GameSummary } from "@/lib/api-types";

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** What kind of table this was, when it was not the usual two. */
function variantTag(game: GameSummary): string | null {
  if (game.variant === "three") return "3-handed";
  if (game.variant === "teams") return "Teams";
  return null;
}

export function GameSection({
  title,
  games,
}: {
  title: string;
  games: GameSummary[];
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);

  const visible = games.filter((game) => !gone.includes(game.id));
  if (visible.length === 0) return null;

  async function remove(game: GameSummary) {
    const live = game.status !== "complete" && game.status !== "awaiting_opponent";
    if (
      live &&
      !window.confirm(
        "This game is still going. Removing it takes it off your list — the " +
          "others keep playing. Remove it?",
      )
    ) {
      return;
    }
    setRemoving(game.id);
    try {
      const response = await fetch(`/api/games/${game.id}`, { method: "DELETE" });
      if (!response.ok) return;
      // Drop it locally first: the refresh below re-reads the list anyway, but
      // the row should go the instant it is pressed.
      setGone((current) => [...current, game.id]);
      router.refresh();
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="stack-sm">
      <h2 className="panel-title">{title}</h2>
      <div className="game-list">
        {visible.map((game) => {
          const tag = variantTag(game);
          return (
            <div className="game-row" key={game.id}>
              <Link
                href={`/games/${game.id}`}
                className={`game-card${game.isYourTurn ? " game-card--turn" : ""}`}
              >
                <div className="stack-sm" style={{ gap: 3, minWidth: 0, flex: 1 }}>
                  <span className="score-name">
                    {game.opponentName ?? "Waiting for an opponent"}
                    {tag && <span className="variant-tag">{tag}</span>}
                  </span>
                  <span className="tiny muted">
                    {game.status === "awaiting_opponent"
                      ? game.inviteCode
                        ? `Invite code ${game.inviteCode}${
                            game.seatsOpen > 1 ? ` · ${game.seatsOpen} seats open` : ""
                          }`
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
                          background: "var(--p1)",
                        }}
                      />
                      <span
                        className="mini-peg"
                        style={{
                          left: `${Math.min(game.yourScore / game.target, 1) * 100}%`,
                          background: "var(--p0)",
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

              <button
                type="button"
                className="game-remove"
                onClick={() => void remove(game)}
                disabled={removing === game.id}
                aria-label={`Remove the game against ${
                  game.opponentName ?? "nobody yet"
                } from your list`}
                title="Remove from your list"
              >
                {removing === game.id ? "…" : "×"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
