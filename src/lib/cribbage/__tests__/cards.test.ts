import { describe, expect, it } from "vitest";
import {
  cardLabel,
  fullDeck,
  isValidCard,
  rankOf,
  seededRng,
  shuffle,
  sortCards,
  suitOf,
  valueOf,
} from "../cards";

describe("card primitives", () => {
  it("parses rank and suit", () => {
    expect(rankOf("AS")).toBe(1);
    expect(rankOf("TD")).toBe(10);
    expect(rankOf("JH")).toBe(11);
    expect(rankOf("KC")).toBe(13);
    expect(suitOf("KC")).toBe("C");
  });

  it("counts face cards as ten and aces as one", () => {
    expect(valueOf("AS")).toBe(1);
    expect(valueOf("9H")).toBe(9);
    expect(valueOf("TD")).toBe(10);
    expect(valueOf("JD")).toBe(10);
    expect(valueOf("QD")).toBe(10);
    expect(valueOf("KD")).toBe(10);
  });

  it("renders a display label", () => {
    expect(cardLabel("TD")).toBe("10♦");
    expect(cardLabel("AS")).toBe("A♠");
  });

  it("validates card codes", () => {
    expect(isValidCard("AS")).toBe(true);
    expect(isValidCard("1S")).toBe(false);
    expect(isValidCard("AX")).toBe(false);
    expect(isValidCard("ASD")).toBe(false);
    expect(isValidCard(42)).toBe(false);
  });

  it("builds a 52-card deck with no duplicates", () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it("shuffles without losing or duplicating cards", () => {
    const deck = fullDeck();
    const shuffled = shuffle(deck, seededRng(7));
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled).size).toBe(52);
    expect(shuffled).not.toEqual(deck);
    // The input must not be mutated.
    expect(deck).toEqual(fullDeck());
  });

  it("is deterministic for a given seed", () => {
    expect(shuffle(fullDeck(), seededRng(99))).toEqual(
      shuffle(fullDeck(), seededRng(99)),
    );
  });

  it("sorts by rank then suit", () => {
    expect(sortCards(["KH", "AS", "TD", "AC"])).toEqual(["AS", "AC", "TD", "KH"]);
  });
});
