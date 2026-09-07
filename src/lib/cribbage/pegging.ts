/**
 * Scoring and legality for the play (pegging) phase.
 */

import { type Card, rankOf, valueOf } from "./cards";
import type { PlayedCard, ScoreBreakdown, ScoreItem } from "./types";

export const MAX_COUNT = 31;

/** Cards from `hand` that fit under 31 given the current running total. */
export function legalPlays(hand: readonly Card[], total: number): Card[] {
  return hand.filter((card) => total + valueOf(card) <= MAX_COUNT);
}

export function canPlay(hand: readonly Card[], total: number): boolean {
  return legalPlays(hand, total).length > 0;
}

/** Trailing cards sharing the last card's rank, longest first. */
function trailingPairCount(sequence: readonly PlayedCard[]): number {
  if (sequence.length === 0) return 0;
  const lastRank = rankOf(sequence[sequence.length - 1]!.card);
  let n = 0;
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (rankOf(sequence[i]!.card) !== lastRank) break;
    n++;
  }
  return n;
}

/**
 * The longest suffix of the sequence forming a run. Order does not matter —
 * 5, 3, 4 is a run of three — but the run must include the card just played
 * and may not repeat a rank.
 */
function trailingRun(sequence: readonly PlayedCard[]): Card[] | null {
  for (let len = sequence.length; len >= 3; len--) {
    const window = sequence.slice(sequence.length - len).map((p) => p.card);
    const ranks = window.map(rankOf).sort((a, b) => a - b);
    const consecutive = ranks.every(
      (rank, i) => i === 0 || rank === ranks[i - 1]! + 1,
    );
    if (consecutive) return window;
  }
  return null;
}

const PLURAL_RANK: Record<number, string> = {
  1: "aces",
  10: "tens",
  11: "jacks",
  12: "queens",
  13: "kings",
};

/**
 * Points earned by the card that has just been added to `sequence`.
 * `sequence` is the current run up to 31 including the new card.
 */
export function scorePlay(sequence: readonly PlayedCard[]): ScoreBreakdown {
  const items: ScoreItem[] = [];
  const total = sequence.length ? sequence[sequence.length - 1]!.total : 0;

  if (total === 15) {
    items.push({ label: "Fifteen", points: 2 });
  }
  if (total === MAX_COUNT) {
    items.push({ label: "Thirty-one", points: 2 });
  }

  const pairCount = trailingPairCount(sequence);
  if (pairCount >= 2) {
    const rank = rankOf(sequence[sequence.length - 1]!.card);
    const plural = PLURAL_RANK[rank] ?? `${rank}s`;
    const cards = sequence.slice(sequence.length - pairCount).map((p) => p.card);
    if (pairCount === 2) {
      items.push({ label: `Pair of ${plural}`, points: 2, cards });
    } else if (pairCount === 3) {
      items.push({ label: `Three ${plural} (pair royal)`, points: 6, cards });
    } else {
      items.push({
        label: `Four ${plural} (double pair royal)`,
        points: 12,
        cards,
      });
    }
  }

  const run = trailingRun(sequence);
  if (run) {
    items.push({ label: `Run of ${run.length}`, points: run.length, cards: run });
  }

  return {
    total: items.reduce((sum, item) => sum + item.points, 0),
    items,
  };
}
