/**
 * The Cribbage state machine.
 *
 * `applyAction` is a pure function of (state, action, context): it never talks
 * to the database, so it can be exhaustively unit tested and safely replayed.
 * Callers persist the returned state and append the returned events.
 *
 * Phase flow for one hand:
 *   discard -> (everyone discarded, starter cut) -> pegging -> counting -> deal
 *
 * The table can seat two, three, or four. Rather than special-case each, the
 * engine works in terms of `state.seats` and walks round the table: the seat
 * left of the dealer leads the play and counts first, and the deal moves one
 * seat left each hand. Heads-up is simply the case where "round the table"
 * means back and forth.
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
  type Variant,
} from "./types";

export const TARGET_SCORE = 121;
export const KEEP_SIZE = 4;

interface VariantSpec {
  seats: number;
  /** Cards dealt to each player. */
  dealt: number;
  /** Cards each player owes the crib. */
  discards: number;
  /**
   * Cards dealt straight to the crib off the deck. Three-handed needs one,
   * because three players owing one card each would leave the crib a card
   * short of a hand.
   */
  cribFromDeck: number;
  /** Partners share a score. */
  partnerships: boolean;
}

export const VARIANTS: Record<Variant, VariantSpec> = {
  two: { seats: 2, dealt: 6, discards: 2, cribFromDeck: 0, partnerships: false },
  three: { seats: 3, dealt: 5, discards: 1, cribFromDeck: 1, partnerships: false },
  teams: { seats: 4, dealt: 5, discards: 1, cribFromDeck: 0, partnerships: true },
};

export function specOf(state: Pick<GameState, "variant">): VariantSpec {
  return VARIANTS[state.variant];
}

export interface EngineContext {
  /** Display names by seat, used to render log messages. */
  names: string[];
  /** Injectable randomness so games can be seeded and replayed in tests. */
  rng: Rng;
}

export function defaultContext(partial: Partial<EngineContext> = {}): EngineContext {
  return {
    names: partial.names ?? ["Player 1", "Player 2", "Player 3", "Player 4"],
    rng: partial.rng ?? Math.random,
  };
}

/** The next seat clockwise. In a two-handed game, the other player. */
export function nextSeat(state: Pick<GameState, "seats">, seat: Seat): Seat {
  return (seat + 1) % state.seats;
}

/** Kept for heads-up callers, where "the other seat" is unambiguous. */
export function otherSeat(seat: Seat): Seat {
  return 1 - seat;
}

/**
 * Scoring track for a seat. Everyone keeps their own score except partners,
 * who share one: seats 0 and 2 against seats 1 and 3.
 */
export function trackOf(state: Pick<GameState, "variant">, seat: Seat): number {
  return VARIANTS[state.variant].partnerships ? seat % 2 : seat;
}

/** How many pegs the board carries: one per player, or one per partnership. */
export function trackCount(state: Pick<GameState, "variant">): number {
  const spec = VARIANTS[state.variant];
  return spec.partnerships ? 2 : spec.seats;
}

/** Seats sharing a track, in seating order. */
export function seatsOnTrack(state: Pick<GameState, "variant">, track: number): Seat[] {
  const spec = VARIANTS[state.variant];
  const all = Array.from({ length: spec.seats }, (_, seat) => seat);
  return all.filter((seat) => trackOf(state, seat) === track);
}

/**
 * Brings a stored state up to the current schema.
 *
 * Schema 1 predates the three- and four-handed game: every such state is a
 * heads-up game, and its two-element arrays are already the right shape for
 * one. Filling in the fields it predates is the whole upgrade, so a game left
 * half-played across a deploy carries on exactly where it was.
 */
export function normalizeState(state: GameState): GameState {
  if (state.schema === 2 && state.variant) return state;
  return {
    ...state,
    schema: 2,
    variant: state.variant ?? "two",
    seats: state.seats ?? 2,
  };
}

export function createGame(
  variant: Variant = "two",
  target: number = TARGET_SCORE,
): GameState {
  const spec = VARIANTS[variant];
  const tracks = spec.partnerships ? 2 : spec.seats;
  return {
    schema: 2,
    variant,
    seats: spec.seats,
    phase: "awaiting_opponent",
    dealer: 0,
    scores: Array<number>(tracks).fill(0),
    prevScores: Array<number>(tracks).fill(0),
    deck: [],
    hands: Array.from({ length: spec.seats }, () => []),
    pegRemaining: Array.from({ length: spec.seats }, () => []),
    crib: [],
    starter: null,
    discarded: Array<boolean>(spec.seats).fill(false),
    play: {
      turn: 1,
      total: 0,
      sequence: [],
      history: [],
      goSaid: Array<boolean>(spec.seats).fill(false),
      lastPlayer: null,
    },
    countIndex: 0,
    handNumber: 0,
    winnerSeat: null,
    target,
  };
}

/**
 * Seats that may act right now. Discarding is simultaneous, so every seat that
 * still owes the crib is pending at once; every other phase yields one seat.
 */
export function pendingSeats(state: GameState): Seat[] {
  switch (state.phase) {
    case "discard":
      return Array.from({ length: state.seats }, (_, seat) => seat).filter(
        (seat) => !state.discarded[seat],
      );
    case "pegging":
      return [state.play.turn];
    case "counting":
      return [counterSeat(state)];
    default:
      return [];
  }
}

/** The single seat to act, or null when zero or several seats may act. */
export function turnSeat(state: GameState): Seat | null {
  const pending = pendingSeats(state);
  return pending.length === 1 ? pending[0]! : null;
}

// --- scoring helpers -------------------------------------------------------

/** Everyone the seat is playing against, as scoring tracks. */
function opposingTracks(state: GameState, seat: Seat): number[] {
  const mine = trackOf(state, seat);
  return state.scores.map((_, track) => track).filter((track) => track !== mine);
}

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
  const track = trackOf(state, seat);
  if (points > 0) {
    state.prevScores[track] = state.scores[track]!;
    state.scores[track] = Math.min(state.scores[track]! + points, state.target);
  }
  events.push({ ...event, points, handNumber: state.handNumber });

  if (state.scores[track]! >= state.target) {
    state.phase = "complete";
    state.winnerSeat = seat;

    // A skunk is measured against whoever came closest.
    const best = Math.max(
      ...opposingTracks(state, seat).map((other) => state.scores[other]!),
    );
    const margin = best < 61 ? " — a double skunk!" : best < 91 ? " — a skunk!" : "";
    events.push({
      type: "win",
      seat,
      message: `${winnerName(state, seat, ctx)} wins ${state.scores[track]}–${best}${margin}`,
      handNumber: state.handNumber,
    });
    return true;
  }
  return false;
}

/** Partners win together, so the win reads as a pair rather than a person. */
function winnerName(state: GameState, seat: Seat, ctx: EngineContext): string {
  if (!specOf(state).partnerships) return ctx.names[seat] ?? `Seat ${seat}`;
  return seatsOnTrack(state, trackOf(state, seat))
    .map((member) => ctx.names[member] ?? `Seat ${member}`)
    .join(" & ");
}

// --- dealing ---------------------------------------------------------------

function beginDeal(state: GameState, events: GameEvent[], ctx: EngineContext): void {
  const spec = specOf(state);
  const deck = shuffle(fullDeck(), ctx.rng);
  state.handNumber += 1;

  let cut = 0;
  state.hands = Array.from({ length: spec.seats }, () => {
    const hand = sortCards(deck.slice(cut, cut + spec.dealt));
    cut += spec.dealt;
    return hand;
  });

  // Three-handed deals one card straight to the crib; nobody sees it.
  state.crib = deck.slice(cut, cut + spec.cribFromDeck);
  cut += spec.cribFromDeck;

  state.deck = deck.slice(cut);
  state.pegRemaining = Array.from({ length: spec.seats }, () => []);
  state.starter = null;
  state.discarded = Array<boolean>(spec.seats).fill(false);
  state.play = {
    turn: nextSeat(state, state.dealer),
    total: 0,
    sequence: [],
    history: [],
    goSaid: Array<boolean>(spec.seats).fill(false),
    lastPlayer: null,
  };
  state.countIndex = 0;
  state.phase = "discard";

  const owed = spec.discards === 1 ? "one card" : "two cards";
  events.push({
    type: "deal",
    seat: null,
    message: `Hand ${state.handNumber}: ${ctx.names[state.dealer]} deals. Each player discards ${owed} to ${ctx.names[state.dealer]}'s crib.`,
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
  state.pegRemaining = state.hands.map((hand) => hand.slice());
  state.play.turn = nextSeat(state, state.dealer);
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
 * or last-card point, and resets the count once nobody round the table can lay
 * a card. With more than two players the search for someone who can play has
 * to walk the whole table, not just glance at the opponent.
 */
function settlePlay(state: GameState, events: GameEvent[], ctx: EngineContext): void {
  for (;;) {
    const outOfCards = state.pegRemaining.every((hand) => hand.length === 0);

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
    if (canPlay(state.pegRemaining[turn]!, state.play.total)) return; // human's move

    // The player to act holds cards but none of them fit under 31.
    if (
      state.pegRemaining[turn]!.length > 0 &&
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

    // Look round the table for anyone who can still lay a card.
    let candidate: Seat | null = null;
    for (let step = 1; step < state.seats; step += 1) {
      const seat = (turn + step) % state.seats;
      if (canPlay(state.pegRemaining[seat]!, state.play.total)) {
        candidate = seat;
        break;
      }
    }
    if (candidate !== null) {
      state.play.turn = candidate;
      return;
    }

    // Nobody can lay a card: score the go and start a fresh count.
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

    // The player left of whoever took the go leads the next count.
    state.play.turn = last !== null ? nextSeat(state, last) : state.play.turn;
    state.play.total = 0;
    state.play.sequence = [];
    state.play.goSaid = Array<boolean>(state.seats).fill(false);
    state.play.lastPlayer = null;
  }
}

// --- the show --------------------------------------------------------------

/**
 * Seat that must count next.
 *
 * The show starts at the dealer's left and works round, so the dealer counts
 * last and then turns the crib — the advantage of the deal is taking the last
 * two counts of the hand.
 */
export function counterSeat(state: GameState): Seat {
  if (state.countIndex >= state.seats) return state.dealer; // the crib
  return (state.dealer + 1 + state.countIndex) % state.seats;
}

/** True when the count now due is the crib rather than somebody's hand. */
export function countingCrib(state: GameState): boolean {
  return state.countIndex >= state.seats;
}

function applyCount(state: GameState, events: GameEvent[], ctx: EngineContext): void {
  const starter = state.starter;
  if (!starter) throw new Error("Cannot count without a starter card");

  const seat = counterSeat(state);
  const isCrib = countingCrib(state);
  const cards = isCrib ? state.crib : state.hands[seat]!;
  const breakdown = scoreShow(cards, starter, { isCrib });

  const where = isCrib ? "the crib" : "hand";
  const ended = award(
    state,
    seat,
    breakdown.total,
    {
      type: "show",
      seat,
      message:
        breakdown.total === 0
          ? `${ctx.names[seat]} scores nothing in ${where}.`
          : `${ctx.names[seat]} scores ${breakdown.total} in ${where}.`,
      detail: { cards: [...cards], starter, breakdown: breakdown.items },
    },
    events,
    ctx,
  );
  if (ended) return;

  state.countIndex += 1;
  if (state.countIndex > state.seats) {
    state.dealer = nextSeat(state, state.dealer);
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
  const next: GameState = structuredClone(normalizeState(state));
  const events: GameEvent[] = [];
  const spec = specOf(next);

  switch (action.type) {
    case "join": {
      assertPhase(next, "awaiting_opponent", "start the game");
      // Cut for deal: low card deals. Simulated as a fair draw for a seat.
      next.dealer = Math.floor(ctx.rng() * next.seats) % next.seats;
      beginDeal(next, events, ctx);
      break;
    }

    case "discard": {
      assertPhase(next, "discard", "discard");
      const { seat, cards } = action;
      if (seat < 0 || seat >= next.seats) {
        throw new IllegalMoveError("That seat is not at this table.");
      }
      if (next.discarded[seat]) {
        throw new IllegalMoveError("You have already discarded this hand.");
      }
      if (!Array.isArray(cards) || cards.length !== spec.discards) {
        throw new IllegalMoveError(
          spec.discards === 1
            ? "Discard exactly one card to the crib."
            : "Discard exactly two cards to the crib.",
        );
      }
      if (new Set(cards).size !== cards.length) {
        throw new IllegalMoveError("Discard two different cards.");
      }
      for (const card of cards) {
        if (!isValidCard(card) || !next.hands[seat]!.includes(card)) {
          throw new IllegalMoveError("You do not hold that card.");
        }
      }

      next.hands[seat] = next.hands[seat]!.filter((card) => !cards.includes(card));
      if (next.hands[seat]!.length !== KEEP_SIZE) {
        throw new IllegalMoveError("Discarding would leave an illegal hand size.");
      }
      next.crib.push(...cards);
      next.discarded[seat] = true;
      events.push({
        type: "discard",
        seat,
        message:
          spec.discards === 1
            ? `${ctx.names[seat]} laid a card away to the crib.`
            : `${ctx.names[seat]} laid two cards away to the crib.`,
        handNumber: next.handNumber,
        detail: { cards: [...cards] },
      });

      if (next.discarded.every(Boolean)) {
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
      if (!isValidCard(card) || !next.pegRemaining[seat]!.includes(card)) {
        throw new IllegalMoveError("You do not hold that card.");
      }
      const value = Math.min(rankOf(card), 10);
      if (next.play.total + value > MAX_COUNT) {
        throw new IllegalMoveError(
          `${cardLabel(card)} would take the count past ${MAX_COUNT}.`,
        );
      }

      next.pegRemaining[seat] = next.pegRemaining[seat]!.filter((c) => c !== card);
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

      next.play.turn = nextSeat(next, seat);
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

/** What the seat about to count is showing, for the turn prompt. */
export function currentCountLabel(state: GameState, names?: string[]): string | null {
  if (state.phase !== "counting") return null;
  if (countingCrib(state)) return "crib";

  const seat = counterSeat(state);
  if (state.seats === 2) {
    return seat === state.dealer ? "dealer's hand" : "non-dealer's hand";
  }
  const name = names?.[seat];
  return name ? `${name}'s hand` : "hand";
}

/** Cards the given seat may legally lay right now. */
export function legalPlaysFor(state: GameState, seat: Seat): Card[] {
  if (state.phase !== "pegging" || state.play.turn !== seat) return [];
  return (state.pegRemaining[seat] ?? []).filter(
    (card) => state.play.total + Math.min(rankOf(card), 10) <= MAX_COUNT,
  );
}
