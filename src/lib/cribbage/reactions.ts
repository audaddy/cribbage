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
  /** What lands in the other player's log. */
  text: string;
  /** Button face. Short — these sit in a row on a phone. */
  label: string;
}

export const REACTIONS: readonly Reaction[] = [
  // "A nineteen hand" is cribbage for a hand worth nothing: nineteen is the
  // one score four cards and a cut cannot make.
  { key: "nineteen", tone: "jab", text: "Nineteen.", label: "Nineteen." },
  { key: "skunk", tone: "jab", text: "Skunk warning.", label: "Skunk warning" },
  { key: "that_it", tone: "jab", text: "That it?", label: "That it?" },
  { key: "my_crib", tone: "jab", text: "Keep feeding my crib.", label: "Feed the crib" },
  { key: "muggins", tone: "jab", text: "Muggins!", label: "Muggins!" },

  { key: "nice_hand", tone: "props", text: "Nice hand.", label: "Nice hand" },
  { key: "well_played", tone: "props", text: "Well played.", label: "Well played" },
  { key: "ouch", tone: "props", text: "Ouch. Respect.", label: "Ouch. Respect." },
  { key: "great_cut", tone: "props", text: "Great cut.", label: "Great cut" },
  { key: "earned", tone: "props", text: "You earned that one.", label: "You earned it" },
] as const;

const BY_KEY = new Map(REACTIONS.map((reaction) => [reaction.key, reaction]));

export function reactionFor(key: string): Reaction | null {
  return BY_KEY.get(key) ?? null;
}

export function reactionsWithTone(tone: ReactionTone): Reaction[] {
  return REACTIONS.filter((reaction) => reaction.tone === tone);
}
