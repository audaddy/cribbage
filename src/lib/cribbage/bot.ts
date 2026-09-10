/**
 * A computer opponent.
 *
 * Pure, like the rest of the engine: it takes a state and returns an action,
 * so it can be played against itself thousands of times in a unit test without
 * touching a database.
 *
 * Cribbage is small enough that the discard can be solved rather than guessed.
 * There are only 15 ways to split six cards and only 46 cards left to cut, so
 * the expected value of every keep is computed exactly. The crib is the part
 * that cannot be: it depends on two cards the opponent has not shown, so it is
 * sampled.
 *
 * The play is heuristic rather than searched. A full search of the pegging
 * would need a model of the opponent's hand, and the returns do not justify it.
 */

import { type Card, type Rng, fullDeck, rankOf, valueOf } from "./cards";
import { legalPlaysFor, otherSeat } from "./engine";
import { MAX_COUNT, scorePlay } from "./pegging";
import { scoreShow } from "./scoring";
import type { GameState, PlayedCard, Seat } from "./types";

/** How many (cut, opponent discard) draws to average the crib over. */
const CRIB_SAMPLES = 60;

/** One imagined completion of the crib: the cut, and the opponent's two cards. */
interface CribDraw {
  cut: Card;
  opponent: [Card, Card];
}

/** Every way to choose two cards to throw from a six-card hand. */
function discardOptions(hand: readonly Card[]): { keep: Card[]; toss: [Card, Card] }[] {
  const options: { keep: Card[]; toss: [Card, Card] }[] = [];
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      options.push({
        keep: hand.filter((_, k) => k !== i && k !== j),
        toss: [hand[i]!, hand[j]!],
      });
    }
  }
  return options;
}

/**
 * Draws the imagined cribs once, to be reused across every candidate discard.
 *
 * Comparing fifteen options against the *same* draws removes the sampling
 * noise from the comparison itself — the thing being measured is the
 * difference between options, and shared randomness cancels out of it. That
 * buys accuracy at a fraction of the samples.
 */
function drawCribs(unseen: readonly Card[], rng: Rng): CribDraw[] {
  const draws: CribDraw[] = [];
  for (let i = 0; i < CRIB_SAMPLES; i++) {
    const a = Math.floor(rng() * unseen.length);
    let b = Math.floor(rng() * unseen.length);
    let c = Math.floor(rng() * unseen.length);
    if (b === a) b = (b + 1) % unseen.length;
    while (c === a || c === b) c = (c + 1) % unseen.length;
    draws.push({ cut: unseen[c]!, opponent: [unseen[a]!, unseen[b]!] });
  }
  return draws;
}

/**
 * What the crib is worth on average, given the two cards being thrown to it.
 *
 * The opponent's two cards are drawn at random, which understates a real crib
 * slightly — an opponent throws away rubbish on purpose — but it ranks the
 * options correctly, which is all the caller needs.
 */
function expectedCrib(toss: readonly Card[], draws: readonly CribDraw[]): number {
  let total = 0;
  for (const draw of draws) {
    total += scoreShow([...toss, ...draw.opponent], draw.cut, { isCrib: true }).total;
  }
  return total / draws.length;
}

/**
 * Picks two cards for the crib by expected value over every possible cut.
 * The crib counts for the dealer and against everyone else, so its value is
 * added or subtracted accordingly.
 */
export function chooseDiscard(
  hand: readonly Card[],
  isDealer: boolean,
  rng: Rng,
): [Card, Card] {
  const unseen = fullDeck().filter((card) => !hand.includes(card));
  const draws = drawCribs(unseen, rng);

  let best: { toss: [Card, Card]; value: number } | null = null;

  for (const { keep, toss } of discardOptions(hand)) {
    // Exact: every remaining card is an equally likely cut.
    let handTotal = 0;
    for (const cut of unseen) handTotal += scoreShow(keep, cut).total;
    const handValue = handTotal / unseen.length;

    const cribValue = expectedCrib(toss, draws);
    const value = handValue + (isDealer ? cribValue : -cribValue);

    if (!best || value > best.value) best = { toss, value };
  }

  return best!.toss;
}

/** Totals a ten-value card turns into points — 16 of the 52 cards do that. */
function invitesTens(total: number): boolean {
  return total === 5 || total === 21;
}

/**
 * Scores a candidate card during the play.
 *
 * Points in hand outweigh everything, then position: leaving the count where a
 * ten-value card scores is the most common way to hand over free points, and
 * sixteen of the fifty-two cards are worth ten.
 */
function playValue(card: Card, sequence: readonly PlayedCard[], seat: Seat): number {
  const total = (sequence.at(-1)?.total ?? 0) + valueOf(card);
  const after: PlayedCard[] = [...sequence, { seat, card, total }];
  const gained = scorePlay(after).total;

  let value = gained * 12;

  // Handing the opponent a fifteen or a thirty-one is the classic leak.
  if (invitesTens(total)) value -= 6;

  // Thirty-one ends the run with the points already counted above; anything
  // that leaves the count high leaves the opponent little room.
  if (total === MAX_COUNT) value += 3;
  else if (total >= 27) value += 2;

  // A five is the worst lead in cribbage: a third of the deck answers it
  // for two.
  if (sequence.length === 0 && rankOf(card) === 5) value -= 8;

  // Low cards are worth keeping for the end of a run, where they are what
  // lets you reach exactly thirty-one.
  if (sequence.length === 0) value -= valueOf(card) * 0.25;

  return value;
}

/** The card the computer would lay right now. */
export function choosePlay(state: GameState, seat: Seat, rng: Rng): Card {
  const legal = legalPlaysFor(state, seat);
  if (legal.length === 0) {
    throw new Error("choosePlay called when the seat has no legal card");
  }

  let best: { card: Card; value: number } | null = null;
  for (const card of legal) {
    // A whisper of noise breaks ties without making play erratic.
    const value = playValue(card, state.play.sequence, seat) + rng() * 0.2;
    if (!best || value > best.value) best = { card, value };
  }
  return best!.card;
}

export type BotAction =
  | { type: "discard"; cards: [Card, Card] }
  | { type: "play"; card: Card }
  | { type: "count" };

/** What the computer does next, given the seat it is playing. */
export function chooseAction(
  state: GameState,
  seat: Seat,
  rng: Rng = Math.random,
): BotAction | null {
  switch (state.phase) {
    case "discard":
      if (state.discarded[seat]) return null;
      return {
        type: "discard",
        cards: chooseDiscard(state.hands[seat], state.dealer === seat, rng),
      };
    case "pegging":
      if (state.play.turn !== seat) return null;
      return { type: "play", card: choosePlay(state, seat, rng) };
    case "counting": {
      const counter = state.countIndex === 0 ? otherSeat(state.dealer) : state.dealer;
      return counter === seat ? { type: "count" } : null;
    }
    default:
      return null;
  }
}
