/**
 * Hand and crib scoring (the "show").
 *
 * Every function returns a full breakdown alongside the total so the UI can
 * explain exactly where the points came from.
 */

import { type Card, rankOf, suitOf, valueOf } from "./cards";
import type { ScoreBreakdown, ScoreItem } from "./types";

const PLURAL_RANK: Record<number, string> = {
  1: "aces",
  10: "tens",
  11: "jacks",
  12: "queens",
  13: "kings",
};

function pluralRank(rank: number): string {
  return PLURAL_RANK[rank] ?? `${rank}s`;
}

/** Every non-empty subset of `cards`, as index bitmasks. */
function subsets(cards: readonly Card[]): Card[][] {
  const out: Card[][] = [];
  const n = cards.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset: Card[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(cards[i]!);
    }
    out.push(subset);
  }
  return out;
}

function scoreFifteens(cards: readonly Card[]): ScoreItem[] {
  return subsets(cards)
    .filter((subset) => subset.length >= 2)
    .filter((subset) => subset.reduce((sum, c) => sum + valueOf(c), 0) === 15)
    .map((subset) => ({ label: "Fifteen", points: 2, cards: subset }));
}

function scorePairs(cards: readonly Card[]): ScoreItem[] {
  const byRank = new Map<number, Card[]>();
  for (const card of cards) {
    const rank = rankOf(card);
    byRank.set(rank, [...(byRank.get(rank) ?? []), card]);
  }

  const items: ScoreItem[] = [];
  for (const [rank, group] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    const n = group.length;
    if (n < 2) continue;
    // n cards of a rank contain n-choose-2 pairs, worth 2 points each.
    const points = n * (n - 1);
    const label =
      n === 2
        ? `Pair of ${pluralRank(rank)}`
        : n === 3
          ? `Three ${pluralRank(rank)} (pair royal)`
          : `Four ${pluralRank(rank)} (double pair royal)`;
    items.push({ label, points, cards: group });
  }
  return items;
}

/** True when the ranks are distinct and consecutive. */
function isRun(cards: readonly Card[]): boolean {
  if (cards.length < 3) return false;
  const ranks = cards.map(rankOf).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i]! !== ranks[i - 1]! + 1) return false;
  }
  return true;
}

/**
 * Only maximal-length runs score. A "double run of three" therefore falls out
 * naturally as two distinct three-card runs rather than needing a special case.
 */
function scoreRuns(cards: readonly Card[]): ScoreItem[] {
  const candidates = subsets(cards).filter(isRun);
  if (candidates.length === 0) return [];

  const longest = Math.max(...candidates.map((run) => run.length));
  return candidates
    .filter((run) => run.length === longest)
    .map((run) => ({
      label: `Run of ${longest}`,
      points: longest,
      cards: run.slice().sort((a, b) => rankOf(a) - rankOf(b)),
    }));
}

/**
 * Four cards of one suit in hand score 4, or 5 when the starter matches.
 * A crib only scores a flush when all five cards share a suit.
 */
function scoreFlush(
  hand: readonly Card[],
  starter: Card,
  isCrib: boolean,
): ScoreItem[] {
  if (hand.length < 4) return [];
  const suit = suitOf(hand[0]!);
  if (!hand.every((card) => suitOf(card) === suit)) return [];

  const starterMatches = suitOf(starter) === suit;
  if (isCrib) {
    return starterMatches
      ? [{ label: "Flush (five cards)", points: 5, cards: [...hand, starter] }]
      : [];
  }
  return starterMatches
    ? [{ label: "Flush (five cards)", points: 5, cards: [...hand, starter] }]
    : [{ label: "Flush (four cards)", points: 4, cards: [...hand] }];
}

/** "One for his nob": a jack in hand matching the starter's suit. */
function scoreNobs(hand: readonly Card[], starter: Card): ScoreItem[] {
  const jack = hand.find(
    (card) => rankOf(card) === 11 && suitOf(card) === suitOf(starter),
  );
  return jack ? [{ label: "His nob", points: 1, cards: [jack, starter] }] : [];
}

export interface ShowOptions {
  /** Cribs use the stricter five-card flush rule. */
  isCrib?: boolean;
}

/**
 * Scores a four-card hand (or crib) against the starter.
 * The starter participates in fifteens, pairs and runs, but is never part of
 * the four-card flush and cannot itself be the nob.
 */
export function scoreShow(
  hand: readonly Card[],
  starter: Card,
  options: ShowOptions = {},
): ScoreBreakdown {
  const all = [...hand, starter];
  const items: ScoreItem[] = [
    ...scoreFifteens(all),
    ...scorePairs(all),
    ...scoreRuns(all),
    ...scoreFlush(hand, starter, options.isCrib ?? false),
    ...scoreNobs(hand, starter),
  ];
  return {
    total: items.reduce((sum, item) => sum + item.points, 0),
    items,
  };
}
