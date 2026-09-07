/**
 * The Cribbage state machine.
 *
 * `applyAction` is a pure function of (state, action, context): it never talks
 * to the database, so it can be exhaustively unit tested and safely replayed.
 * Callers persist the returned state and append the returned events.
 *
 * Phase flow for one hand:
 *   discard -> (both discarded, starter cut) -> pegging -> counting -> next deal
 */

import {
  type Card,
  type Rng,
  cardLabel,
  fullDeck,
  isValidCard,
  rankOf,
  shuffle,
  sortCards,
} from "./cards";
import { MAX_COUNT, canPlay, scorePlay } from "./pegging";
import { scoreShow } from "./scoring";
import {
  type Action,
  type ApplyResult,
  type GameEvent,
  type GameState,
  IllegalMoveError,
  type Seat,
} from "./types";

export const TARGET_SCORE = 121;
const HAND_SIZE = 6;
const KEEP_SIZE = 4;

export interface EngineContext {
  /** Display names by seat, used to render log messages. */
  names: [string, string];
  /** Injectable randomness so games can be seeded and replayed in tests. */
  rng: Rng;
}

export function defaultContext(partial: Partial<EngineContext> = {}): EngineContext {
  return {
    names: partial.names ?? ["Player 1", "Player 2"],
    rng: partial.rng ?? Math.random,
  };
}

export function otherSeat(seat: Seat): Seat {
  return (1 - seat) as Seat;
}

export function createGame(target: number = TARGET_SCORE): GameState {
  return {
    schema: 1,
    phase: "awaiting_opponent",
    dealer: 0,
    scores: [0, 0],
    prevScores: [0, 0],
    deck: [],
    hands: [[], []],
    pegRemaining: [[], []],
    crib: [],
    starter: null,
    discarded: [false, false],
    play: {
      turn: 1,
      total: 0,
      sequence: [],
      history: [],
      goSaid: [false, false],
      lastPlayer: null,
    },
    countIndex: 0,
    handNumber: 0,
    winnerSeat: null,
    target,
  };
}

/**
 * Seats that may act right now. Discarding is simultaneous, so both seats can
 * be pending at once; every other phase yields exactly one seat.
 */
export function pendingSeats(state: GameState): Seat[] {
  switch (state.phase) {
    case "discard":
      return ([0, 1] as Seat[]).filter((seat) => !state.discarded[seat]);
    case "pegging":
      return [state.play.turn];
    case "counting":
      return [state.countIndex === 0 ? otherSeat(state.dealer) : state.dealer];
    default:
      return [];
  }
}

/** The single seat to act, or null when zero or both seats may act. */
export function turnSeat(state: GameState): Seat | null {
  const pending = pendingSeats(state);
  return pending.length === 1 ? pending[0]! : null;
}

// --- scoring helpers -------------------------------------------------------

/**
 * Awards points and detects the win. Returns true when the game just ended, in
 * which case the caller must stop immediately — a hand can be won mid-show.
 */
function award(
  state: GameState,
  seat: Seat,
  points: number,
  event: Omit<GameEvent, "points" | "handNumber">,
  events: GameEvent[],
  ctx: EngineContext,
): boolean {
  if (points > 0) {
    state.prevScores[seat] = state.scores[seat];
    state.scores[seat] = Math.min(state.scores[seat] + points, state.target);
  }
  events.push({ ...event, points, handNumber: state.handNumber });

  if (state.scores[seat] >= state.target) {
    state.phase = "complete";
    state.winnerSeat = seat;
    const loserScore = state.scores[otherSeat(seat)];
    const margin =
      loserScore < 61 ? " — a double skunk!" : loserScore < 91 ? " — a skunk!" : "";
    events.push({
      type: "win",
      seat,
      message: `${ctx.names[seat]} wins ${state.scores[seat]}–${loserScore}${margin}`,
      handNumber: state.handNumber,
    });
    return true;
  }
  return false;
}

// --- dealing ---------------------------------------------------------------

function beginDeal(state: GameState, events: GameEvent[], ctx: EngineContext): void {
  const deck = shuffle(fullDeck(), ctx.rng);
  state.handNumber += 1;
  state.hands = [
    sortCards(deck.slice(0, HAND_SIZE)),
    sortCards(deck.slice(HAND_SIZE, HAND_SIZE * 2)),
  ];
  state.deck = deck.slice(HAND_SIZE * 2);
  state.pegRemaining = [[], []];
  state.crib = [];
  state.starter = null;
  state.discarded = [false, false];
  state.play = {
    turn: otherSeat(state.dealer),
    total: 0,
    sequence: [],
    history: [],
    goSaid: [false, false],
    lastPlayer: null,
  };
  state.countIndex = 0;
  state.phase = "discard";

  events.push({
    type: "deal",
    seat: null,
    message: `Hand ${state.handNumber}: ${ctx.names[state.dealer]} deals. Each player discards two to ${ctx.names[state.dealer]}'s crib.`,
    handNumber: state.handNumber,
  });
}

/** Cuts the starter and opens the play. May end the game via his heels. */
function cutStarter(state: GameState, events: GameEvent[], ctx: EngineContext): void {
  const starter = state.deck.pop();
  if (!starter) throw new Error("Deck exhausted before the starter was cut");

  state.starter = starter;
  events.push({
    type: "cut",
    seat: null,
    message: `Starter cut: ${cardLabel(starter)}.`,
    handNumber: state.handNumber,
    detail: { starter, card: starter },
  });

  // "His heels": the dealer takes two when a jack is turned up.
  if (rankOf(starter) === 11) {
    const ended = award(
      state,
      state.dealer,
      2,
      {
        type: "peg",
        seat: state.dealer,
        message: `${ctx.names[state.dealer]} takes 2 for his heels.`,
        detail: { card: starter },
      },
      events,
      ctx,
    );
    if (ended) return;
  }

  state.phase = "pegging";
  state.pegRemaining = [state.hands[0].slice(), state.hands[1].slice()];
  state.play.turn = otherSeat(state.dealer);
}

// --- the play --------------------------------------------------------------

function endPlayPhase(state: GameState): void {
  state.phase = "counting";
  state.countIndex = 0;
}

/**
 * Advances the play until a human decision is required or the hand is over.
 *
 * Declares "go" for any player holding cards none of which fit, awards the go
 * or last-card point, and resets the count when neither player can lay a card.
 */
function settlePlay(state: GameState, events: GameEvent[], ctx: EngineContext): void {
  for (;;) {
    const outOfCards =
      state.pegRemaining[0].length === 0 && state.pegRemaining[1].length === 0;

    if (outOfCards) {
      const last = state.play.lastPlayer;
      if (last !== null && state.play.total !== MAX_COUNT) {
        const ended = award(
          state,
          last,
          1,
          {
            type: "peg",
            seat: last,
            message: `${ctx.names[last]} takes 1 for the last card.`,
          },
          events,
          ctx,
        );
        if (ended) return;
      }
      endPlayPhase(state);
      return;
    }

    const turn = state.play.turn;
    if (canPlay(state.pegRemaining[turn], state.play.total)) return; // human's move

    // The player to act holds cards but none of them fit under 31.
    if (
      state.pegRemaining[turn].length > 0 &&
      !state.play.goSaid[turn] &&
      state.play.total !== MAX_COUNT
    ) {
      state.play.goSaid[turn] = true;
      events.push({
        type: "go",
        seat: turn,
        message: `${ctx.names[turn]} says "go".`,
        handNumber: state.handNumber,
        detail: { total: state.play.total },
      });
    }

    const opponent = otherSeat(turn);
    if (canPlay(state.pegRemaining[opponent], state.play.total)) {
      state.play.turn = opponent;
      return;
    }

    // Neither player can lay a card: score the go and start a fresh count.
    const last = state.play.lastPlayer;
    if (last !== null && state.play.total !== MAX_COUNT) {
      const ended = award(
        state,
        last,
        1,
        {
          type: "peg",
          seat: last,
          message: `${ctx.names[last]} takes 1 for the go.`,
          detail: { total: state.play.total },
        },
        events,
        ctx,
      );
      if (ended) return;
    }

    state.play.turn = last !== null ? otherSeat(last) : state.play.turn;
    state.play.total = 0;
    state.play.sequence = [];
    state.play.goSaid = [false, false];
    state.play.lastPlayer = null;
  }
}

// --- the show --------------------------------------------------------------

/** Seat that must count next: non-dealer's hand, dealer's hand, then the crib. */
function counterSeat(state: GameState): Seat {
  return state.countIndex === 0 ? otherSeat(state.dealer) : state.dealer;
}

function applyCount(
  state: GameState,
  events: GameEvent[],
  ctx: EngineContext,
): void {
  const starter = state.starter;
  if (!starter) throw new Error("Cannot count without a starter card");

  const seat = counterSeat(state);
  const isCrib = state.countIndex === 2;
  const cards = isCrib ? state.crib : state.hands[seat];
  const breakdown = scoreShow(cards, starter, { isCrib });

  const what = isCrib ? "crib" : "hand";
  const ended = award(
    state,
    seat,
    breakdown.total,
    {
      type: "show",
      seat,
      message:
        breakdown.total === 0
          ? `${ctx.names[seat]} scores nothing in ${what === "crib" ? "the crib" : "hand"}.`
          : `${ctx.names[seat]} scores ${breakdown.total} in ${what === "crib" ? "the crib" : "hand"}.`,
      detail: { cards: [...cards], starter, breakdown: breakdown.items },
    },
    events,
    ctx,
  );
  if (ended) return;

  state.countIndex += 1;
  if (state.countIndex > 2) {
    state.dealer = otherSeat(state.dealer);
    beginDeal(state, events, ctx);
  }
}

// --- public entry point ----------------------------------------------------

function assertPhase(state: GameState, phase: GameState["phase"], what: string): void {
  if (state.phase !== phase) {
    throw new IllegalMoveError(`Cannot ${what} during the ${state.phase} phase.`);
  }
}

export function applyAction(
  state: GameState,
  action: Action,
  context: Partial<EngineContext> = {},
): ApplyResult {
  const ctx = defaultContext(context);
  // Deep clone so callers keep an untouched copy on failure.
  const next: GameState = structuredClone(state);
  const events: GameEvent[] = [];

  switch (action.type) {
    case "join": {
      assertPhase(next, "awaiting_opponent", "start the game");
      // Cut for deal: low card deals. Simulated as a fair coin flip.
      next.dealer = (ctx.rng() < 0.5 ? 0 : 1) as Seat;
      beginDeal(next, events, ctx);
      break;
    }

    case "discard": {
      assertPhase(next, "discard", "discard");
      const { seat, cards } = action;
      if (next.discarded[seat]) {
        throw new IllegalMoveError("You have already discarded this hand.");
      }
      if (!Array.isArray(cards) || cards.length !== 2) {
        throw new IllegalMoveError("Discard exactly two cards to the crib.");
      }
      if (cards[0] === cards[1]) {
        throw new IllegalMoveError("Discard two different cards.");
      }
      for (const card of cards) {
        if (!isValidCard(card) || !next.hands[seat].includes(card)) {
          throw new IllegalMoveError("You do not hold that card.");
        }
      }

      next.hands[seat] = next.hands[seat].filter((card) => !cards.includes(card));
      if (next.hands[seat].length !== KEEP_SIZE) {
        throw new IllegalMoveError("Discarding would leave an illegal hand size.");
      }
      next.crib.push(...cards);
      next.discarded[seat] = true;
      events.push({
        type: "discard",
        seat,
        message: `${ctx.names[seat]} laid two cards away to the crib.`,
        handNumber: next.handNumber,
        detail: { cards: [...cards] },
      });

      if (next.discarded[0] && next.discarded[1]) {
        cutStarter(next, events, ctx);
        if (next.phase === "pegging") settlePlay(next, events, ctx);
      }
      break;
    }

    case "play": {
      assertPhase(next, "pegging", "play a card");
      const { seat, card } = action;
      if (seat !== next.play.turn) {
        throw new IllegalMoveError("It is not your turn to play.");
      }
      if (!isValidCard(card) || !next.pegRemaining[seat].includes(card)) {
        throw new IllegalMoveError("You do not hold that card.");
      }
      const value = Math.min(rankOf(card), 10);
      if (next.play.total + value > MAX_COUNT) {
        throw new IllegalMoveError(
          `${cardLabel(card)} would take the count past ${MAX_COUNT}.`,
        );
      }

      next.pegRemaining[seat] = next.pegRemaining[seat].filter((c) => c !== card);
      next.play.total += value;
      const played = { seat, card, total: next.play.total };
      next.play.sequence.push(played);
      next.play.history.push(played);
      next.play.lastPlayer = seat;

      events.push({
        type: "play",
        seat,
        message: `${ctx.names[seat]} played ${cardLabel(card)} — count is ${next.play.total}.`,
        handNumber: next.handNumber,
        detail: { card, total: next.play.total },
      });

      const pegged = scorePlay(next.play.sequence);
      if (pegged.total > 0) {
        const ended = award(
          next,
          seat,
          pegged.total,
          {
            type: "peg",
            seat,
            message: `${ctx.names[seat]} pegs ${pegged.total} (${pegged.items
              .map((item) => item.label.toLowerCase())
              .join(", ")}).`,
            detail: {
              card,
              total: next.play.total,
              breakdown: pegged.items,
            },
          },
          events,
          ctx,
        );
        if (ended) break;
      }

      next.play.turn = otherSeat(seat);
      settlePlay(next, events, ctx);
      break;
    }

    case "count": {
      assertPhase(next, "counting", "count");
      if (action.seat !== counterSeat(next)) {
        throw new IllegalMoveError("It is not your count.");
      }
      applyCount(next, events, ctx);
      break;
    }

    default: {
      const exhaustive: never = action;
      throw new IllegalMoveError(`Unknown action: ${JSON.stringify(exhaustive)}`);
    }
  }

  return { state: next, events };
}

/** What the seat about to count is showing: their hand, or the crib. */
export function currentCountLabel(state: GameState): string | null {
  if (state.phase !== "counting") return null;
  return state.countIndex === 0
    ? "non-dealer's hand"
    : state.countIndex === 1
      ? "dealer's hand"
      : "crib";
}

/** Cards the given seat may legally lay right now. */
export function legalPlaysFor(state: GameState, seat: Seat): Card[] {
  if (state.phase !== "pegging" || state.play.turn !== seat) return [];
  return state.pegRemaining[seat].filter(
    (card) => state.play.total + Math.min(rankOf(card), 10) <= MAX_COUNT,
  );
}
