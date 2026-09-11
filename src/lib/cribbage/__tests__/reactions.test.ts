import { describe, expect, it } from "vitest";
import { REACTIONS, reactionFor, reactionsWithTone } from "../reactions";

describe("reactions", () => {
  it("has no duplicate keys", () => {
    const keys = REACTIONS.map((reaction) => reaction.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("offers both tones", () => {
    expect(reactionsWithTone("jab").length).toBeGreaterThan(0);
    expect(reactionsWithTone("props").length).toBeGreaterThan(0);
  });

  it("resolves a known key and refuses anything else", () => {
    expect(reactionFor("nineteen")?.text).toBe("Nineteen.");
    expect(reactionFor("drop table")).toBeNull();
    expect(reactionFor("")).toBeNull();
  });

  it("keeps button faces short enough for a phone", () => {
    for (const reaction of REACTIONS) {
      expect(reaction.label.length).toBeLessThanOrEqual(16);
    }
  });
});
