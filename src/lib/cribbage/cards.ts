/**
 * Card primitives.
 *
 * A card is encoded as a two-character string: rank char + suit char, e.g.
 * "AS" (ace of spades), "TD" (ten of diamonds), "5H". The encoding is compact,
 * human-readable in logs, and safe to store directly in JSON.
 */

export const SUITS = ["S", "H", "D", "C"] as const;
export type Suit = (typeof SUITS)[number];

/** 1 = ace … 11 = jack, 12 = queen, 13 = king. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export type Card = string;

const RANK_CHARS = "A23456789TJQK";

export const SUIT_NAMES: Record<Suit, string> = {
  S: "Spades",
  H: "Hearts",
  D: "Diamonds",
  C: "Clubs",
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
};

export function makeCard(rank: Rank, suit: Suit): Card {
  return RANK_CHARS[rank - 1] + suit;
}

export function rankOf(card: Card): Rank {
  const index = RANK_CHARS.indexOf(card[0]!.toUpperCase());
  if (index < 0) throw new Error(`Invalid card rank: ${card}`);
  return (index + 1) as Rank;
}

export function suitOf(card: Card): Suit {
  const suit = card[1]!.toUpperCase() as Suit;
  if (!SUITS.includes(suit)) throw new Error(`Invalid card suit: ${card}`);
  return suit;
}

/** Pegging/counting value: face cards are worth 10, ace is worth 1. */
export function valueOf(card: Card): number {
  return Math.min(rankOf(card), 10);
}

export function isValidCard(card: unknown): card is Card {
  if (typeof card !== "string" || card.length !== 2) return false;
  return (
    RANK_CHARS.includes(card[0]!.toUpperCase()) &&
    (SUITS as readonly string[]).includes(card[1]!.toUpperCase())
  );
}

/** Display label, e.g. "10♦" or "J♠". */
export function cardLabel(card: Card): string {
  const rank = rankOf(card);
  const rankText = rank === 10 ? "10" : RANK_CHARS[rank - 1]!;
  return `${rankText}${SUIT_SYMBOLS[suitOf(card)]}`;
}

export function rankName(card: Card): string {
  const rank = rankOf(card);
  const names: Record<number, string> = {
    1: "ace",
    11: "jack",
    12: "queen",
    13: "king",
  };
  return names[rank] ?? String(rank);
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1 as number; rank <= 13; rank++) {
      deck.push(makeCard(rank as Rank, suit));
    }
  }
  return deck;
}

/** Random source, injectable so games and tests can be made deterministic. */
export type Rng = () => number;

/** Deterministic PRNG (mulberry32) — used by tests and seeded games. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates. Returns a new array; the input is not mutated. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Sorts by rank then suit — purely cosmetic, for stable hand display. */
export function sortCards(cards: readonly Card[]): Card[] {
  return cards
    .slice()
    .sort(
      (a, b) =>
        rankOf(a) - rankOf(b) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)),
    );
}
