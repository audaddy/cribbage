import { cardLabel, rankOf, suitOf, type Card } from "@/lib/cribbage";

const RED_SUITS = new Set(["H", "D"]);

export function cardText(card: Card): { rank: string; pip: string; red: boolean } {
  const label = cardLabel(card);
  const suit = suitOf(card);
  return {
    rank: label.slice(0, label.length - 1),
    pip: label.slice(-1),
    red: RED_SUITS.has(suit),
  };
}

/** Full accessible name, e.g. "ten of diamonds". */
export function cardName(card: Card): string {
  const rank = rankOf(card);
  const rankNames: Record<number, string> = {
    1: "ace",
    11: "jack",
    12: "queen",
    13: "king",
  };
  const suitNames: Record<string, string> = {
    S: "spades",
    H: "hearts",
    D: "diamonds",
    C: "clubs",
  };
  return `${rankNames[rank] ?? rank} of ${suitNames[suitOf(card)]}`;
}

interface PlayingCardProps {
  card: Card;
  small?: boolean;
  starter?: boolean;
}

export function PlayingCard({ card, small, starter }: PlayingCardProps) {
  const { rank, pip, red } = cardText(card);
  return (
    <div
      className={[
        "pcard",
        red ? "pcard--red" : "",
        small ? "pcard--sm" : "",
        starter ? "pcard--starter" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={cardName(card)}
    >
      <span className="pcard-rank" aria-hidden="true">
        {rank}
        {pip}
      </span>
      <span className="pcard-pip" aria-hidden="true">
        {pip}
      </span>
    </div>
  );
}

/** A face-down card, used for the opponent's hand and the crib. */
export function CardBack({ small }: { small?: boolean }) {
  return (
    <div
      className={`pcard pcard--back${small ? " pcard--sm" : ""}`}
      role="img"
      aria-label="face-down card"
    />
  );
}
