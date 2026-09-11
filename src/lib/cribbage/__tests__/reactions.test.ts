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
    expect(reactionFor("womp")?.text).toBe("Womp womp.");
    expect(reactionFor("drop table")).toBeNull();
    expect(reactionFor("")).toBeNull();
  });

  it("keeps lines short enough to sit on a button", () => {
    // Measured against the narrow phone layout: past roughly this length a
    // chip stops fitting one line of a 375px screen and the row falls apart.
    for (const reaction of REACTIONS) {
      expect(reaction.text.length).toBeLessThanOrEqual(36);
    }
  });
});
