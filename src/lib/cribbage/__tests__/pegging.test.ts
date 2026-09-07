import { describe, expect, it } from "vitest";
import { canPlay, legalPlays, scorePlay } from "../pegging";
import type { PlayedCard, Seat } from "../types";
import { valueOf } from "../cards";

/** Builds a play sequence from card codes, alternating seats. */
function seq(...cards: string[]): PlayedCard[] {
  let total = 0;
  return cards.map((card, i) => {
    total += valueOf(card);
    return { seat: (i % 2) as Seat, card, total };
  });
}

describe("legal plays", () => {
  it("only allows cards that keep the count at or under 31", () => {
    expect(legalPlays(["KS", "3H", "2D"], 28)).toEqual(["3H", "2D"]);
    expect(legalPlays(["KS", "QH"], 28)).toEqual([]);
    expect(canPlay(["KS", "QH"], 28)).toBe(false);
    expect(canPlay(["AS"], 30)).toBe(true);
  });

  it("treats an empty hand as unable to play", () => {
    expect(canPlay([], 0)).toBe(false);
  });
});

describe("pegging scores", () => {
  it("scores fifteen", () => {
    expect(scorePlay(seq("7S", "8H")).total).toBe(2);
    expect(scorePlay(seq("5S", "TH")).total).toBe(2);
  });

  it("scores thirty-one", () => {
    // 10 + 10 + 10 + A = 31
    expect(scorePlay(seq("TS", "TH", "TD", "AC")).total).toBe(2);
  });

  it("scores a pair, pair royal and double pair royal", () => {
    expect(scorePlay(seq("7S", "7H")).total).toBe(2);
    expect(scorePlay(seq("2S", "2H", "2D")).total).toBe(6);
    expect(scorePlay(seq("2S", "2H", "2D", "2C")).total).toBe(12);
  });

  it("does not pair across an intervening card", () => {
    expect(scorePlay(seq("7S", "3H", "7D")).total).toBe(0);
  });

  it("scores a run regardless of the order the cards were laid", () => {
    expect(scorePlay(seq("3S", "4H", "5D")).total).toBe(3);
    expect(scorePlay(seq("5S", "3H", "4D")).total).toBe(3);
    expect(scorePlay(seq("4S", "6H", "3D", "5C")).total).toBe(4);
  });

  it("restarts a run when a rank repeats", () => {
    // 6-7-6-8: the last three cards (7,6,8) still form a run of three.
    expect(scorePlay(seq("6S", "7H", "6D", "8C")).total).toBe(3);
  });

  it("does not score a two-card run", () => {
    expect(scorePlay(seq("3S", "4H")).total).toBe(0);
  });

  it("combines a fifteen with a pair royal", () => {
    // 5-5-5 makes fifteen (2) and a pair royal (6).
    const result = scorePlay(seq("5S", "5H", "5D"));
    expect(result.total).toBe(8);
    expect(result.items.map((i) => i.points).sort()).toEqual([2, 6]);
  });

  it("combines a run with a fifteen", () => {
    // 4 + 5 + 6 = 15 and a run of three.
    expect(scorePlay(seq("4S", "5H", "6D")).total).toBe(5);
  });

  it("scores nothing for an empty or single-card sequence", () => {
    expect(scorePlay([]).total).toBe(0);
    expect(scorePlay(seq("9S")).total).toBe(0);
  });

  it("breakdown items always sum to the total", () => {
    const sequences = [
      seq("5S", "5H", "5D"),
      seq("4S", "5H", "6D"),
      seq("TS", "TH", "TD", "AC"),
      seq("2S", "2H", "2D", "2C"),
    ];
    for (const s of sequences) {
      const result = scorePlay(s);
      expect(result.items.reduce((a, i) => a + i.points, 0)).toBe(result.total);
    }
  });
});
