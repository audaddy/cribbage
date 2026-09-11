/**
 * Table talk.
 *
 * Cribbage is a game people play across a kitchen table, and half of it is
 * what gets said over the board. Played asynchronously that disappears, so
 * these are the two things anyone actually says — a jab and a compliment —
 * reduced to one tap.
 *
 * A reaction is not a move: it changes no score and no state. It is kept here,
 * beside the rules, only because the vocabulary is the game's own.
 */

export type ReactionTone = "jab" | "props";

export interface Reaction {
  key: string;
  tone: ReactionTone;
  /** The line itself. Doubles as the button face: what you press is what you
   *  send, with nothing lost between the two. */
  text: string;
}

export const REACTIONS: readonly Reaction[] = [
  { key: "grandma", tone: "jab", text: "My grandmother pegs better." },
  { key: "blink", tone: "jab", text: "Blink twice if you need help." },
  { key: "go_easy", tone: "jab", text: "Should I go easy?" },
  { key: "clock", tone: "jab", text: "I've seen better hands on a clock." },
  { key: "womp", tone: "jab", text: "Womp womp." },

  { key: "done_this", tone: "props", text: "You've done this before." },
  { key: "ouch", tone: "props", text: "Ouch. Respect." },
  { key: "didnt_see", tone: "props", text: "Didn't see that coming." },
  { key: "walked_into", tone: "props", text: "I walked into that." },
  { key: "deserved", tone: "props", text: "Deserved." },
] as const;

const BY_KEY = new Map(REACTIONS.map((reaction) => [reaction.key, reaction]));

export function reactionFor(key: string): Reaction | null {
  return BY_KEY.get(key) ?? null;
}

export function reactionsWithTone(tone: ReactionTone): Reaction[] {
  return REACTIONS.filter((reaction) => reaction.tone === tone);
}
