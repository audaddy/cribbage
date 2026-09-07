import { describe, expect, it } from "vitest";
import { scoreShow } from "../scoring";

const total = (hand: string[], starter: string, isCrib = false) =>
  scoreShow(hand, starter, { isCrib }).total;

describe("the show", () => {
  it("scores the perfect 29 hand", () => {
    // Three fives plus the jack matching the starter's suit.
    const result = scoreShow(["5H", "5S", "5C", "JD"], "5D");
    expect(result.total).toBe(29);
    // Eight fifteens (16), four-of-a-kind (12), his nob (1).
    expect(
      result.items.filter((item) => item.label === "Fifteen"),
    ).toHaveLength(8);
    expect(result.items.some((item) => item.points === 12)).toBe(true);
    expect(result.items.some((item) => item.label === "His nob")).toBe(true);
  });

  it("scores a hand of all even values as zero", () => {
    expect(total(["KS", "8H", "4D", "2C"], "6S")).toBe(0);
  });

  it("scores a double run of three with the pair and fifteens", () => {
    // 4-5-5-6 with a 2: two runs of three (6), a pair (2), two fifteens (4).
    const result = scoreShow(["4S", "5S", "5H", "6D"], "2C");
    expect(result.total).toBe(12);
    expect(result.items.filter((i) => i.label === "Run of 3")).toHaveLength(2);
    expect(result.items.filter((i) => i.label === "Fifteen")).toHaveLength(2);
  });

  it("scores only the longest run, not its sub-runs", () => {
    // A-2-3-4 is one run of four (4), not several runs of three.
    // Plus two fifteens: A+4+K and 2+3+K.
    const result = scoreShow(["AS", "2H", "3D", "4C"], "KS");
    const runs = result.items.filter((i) => i.label.startsWith("Run"));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.points).toBe(4);
    expect(result.total).toBe(8);
  });

  it("scores a double pair royal", () => {
    const result = scoreShow(["7S", "7H", "7D", "7C"], "KS");
    expect(result.items.some((i) => i.points === 12)).toBe(true);
    // Four sevens (12) plus two fifteens from 7+8? No eight — 12 exactly.
    expect(result.total).toBe(12);
  });

  it("scores a four-card flush in hand, five with the starter", () => {
    expect(total(["2H", "4H", "6H", "8H"], "TS")).toBe(4);
    expect(total(["2H", "4H", "6H", "8H"], "TH")).toBe(5);
  });

  it("requires five cards for a flush in the crib", () => {
    expect(total(["2H", "4H", "6H", "8H"], "TS", true)).toBe(0);
    expect(total(["2H", "4H", "6H", "8H"], "TH", true)).toBe(5);
  });

  it("scores his nob only for a matching-suit jack in hand", () => {
    expect(total(["JC", "2D", "4S", "6H"], "9C")).toBe(5); // 2 fifteens + nob
    expect(total(["JC", "2D", "4S", "6H"], "9S")).toBe(4); // fifteens only
  });

  it("does not award his nob when the starter is itself a jack", () => {
    const result = scoreShow(["2D", "4S", "6H", "8C"], "JC");
    expect(result.items.some((i) => i.label === "His nob")).toBe(false);
  });

  it("breakdown points always sum to the reported total", () => {
    const hands: [string[], string][] = [
      [["5H", "5S", "5C", "JD"], "5D"],
      [["4S", "5S", "5H", "6D"], "2C"],
      [["AS", "2H", "3D", "4C"], "5S"],
      [["TH", "JH", "QH", "KH"], "9H"],
    ];
    for (const [hand, starter] of hands) {
      const result = scoreShow(hand, starter);
      const sum = result.items.reduce((acc, item) => acc + item.points, 0);
      expect(sum).toBe(result.total);
    }
  });

  it("scores a run of five with a flush", () => {
    // 10-J-Q-K in hand with a 9 cut: run of five (5) + four-card flush (4).
    expect(total(["TH", "JH", "QH", "KH"], "9S")).toBe(9);
    // Cutting the nine of hearts makes it a five-card flush and adds his nob.
    expect(total(["TH", "JH", "QH", "KH"], "9H")).toBe(11);
  });
});
