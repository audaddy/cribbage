"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { GameDetail, MoveRequest } from "@/lib/api-types";
import { type Card, type PlayedCard as PlayedCardState, type Seat, cardLabel } from "@/lib/cribbage";
import { CribbageBoard } from "./CribbageBoard";
import { HistoryLog } from "./HistoryLog";
import { CardBack, PlayingCard, cardName, withCardChips } from "./PlayingCard";
import {
  Burst,
  Confetti,
  useCountUp,
  useIsClient,
  usePrefersReducedMotion,
} from "./motion";

/** Poll faster while waiting on the opponent than while the board is yours. */
const POLL_WAITING_MS = 6000;
const POLL_ACTIVE_MS = 20000;
/** How long the computer appears to think before each move. */
const BOT_THINK_MS = 900;
const TOAST_MS = 4500;
const BUMP_MS = 1600;

interface Toast {
  id: number;
  text: string;
}

export function GameClient({ initial }: { initial: GameDetail }) {
  const [detail, setDetail] = useState(initial);
  const [selected, setSelected] = useState<Card[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bump, setBump] = useState<{ seat: Seat; delta: number; key: number } | null>(
    null,
  );
  /** True for the moment after a deal, while cards fly in from the deck. */
  const [dealing, setDealing] = useState(true);
  /** Increments each time the turn comes back to you, to re-run the sheen. */
  const [turnArrival, setTurnArrival] = useState(0);
  /** Log seq at the moment of the last update; anything above it is new. */
  const [freshAfter, setFreshAfter] = useState<number | null>(null);

  const inFlight = useRef(false);
  const detailRef = useRef(detail);
  const scoresRef = useRef(detail.view.scores);
  const toastId = useRef(0);
  /** Where a card sat in the hand at the moment it was played. */
  const [flight, setFlight] = useState<CardFlight | null>(null);
  /**
   * Where the two cards sat when they were laid away, plus how big the crib
   * was at that moment. The size matters: between the click and the server's
   * reply the crib still holds its old cards, and without the offset those
   * would animate out of this player's hand.
   */
  const [cribFlight, setCribFlight] = useState<
    { from: number; cards: CardFlight[] } | null
  >(null);
  const handRef = useRef(detail.view.handNumber);
  const wasYourTurn = useRef(detail.view.isYourTurn);

  const { view } = detail;
  const names: [string, string] =
    view.you === 0
      ? [detail.you.name, detail.opponent?.name ?? "Opponent"]
      : [detail.opponent?.name ?? "Opponent", detail.you.name];
  const opponentName = detail.opponent?.name ?? "an opponent yet to join";

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  const pushToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, text }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      TOAST_MS,
    );
  }, []);

  // --- polling ------------------------------------------------------------

  /** Adopts a server payload, announcing whatever the opponent did in it. */
  const applyDetail = useCallback(
    (next: GameDetail) => {
      const current = detailRef.current;
      // Never clobber a newer local state with a stale poll response.
      if (next.version <= current.version) return;

      // Surface what the opponent did while we were watching.
      const lastSeen = current.log.at(-1)?.seq ?? -1;
      const theirs = next.log.filter(
        (entry) =>
          entry.seq > lastSeen && entry.seat !== null && entry.seat !== next.view.you,
      );
      const notable = theirs.filter((entry) => entry.type !== "deal").at(-1);
      if (notable) pushToast(notable.message);

      setFreshAfter(lastSeen);
      setDetail(next);
    },
    [pushToast],
  );

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(`/api/games/${initial.id}`, { cache: "no-store" });
      if (!response.ok) return;
      applyDetail((await response.json()) as GameDetail);
    } catch {
      /* offline or transient — the next tick will retry */
    } finally {
      inFlight.current = false;
    }
  }, [applyDetail, initial.id]);

  useEffect(() => {
    if (view.phase === "complete") return;
    const interval = window.setInterval(
      refresh,
      view.isYourTurn ? POLL_ACTIVE_MS : POLL_WAITING_MS,
    );
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, view.isYourTurn, view.phase]);

  // --- the computer's turn ------------------------------------------------

  /**
   * The computer plays one card, or makes one discard, per request. Waiting a
   * beat first is the whole point: the move then lands as its own state change
   * and gets its own animation, instead of appearing in the same breath as
   * yours.
   */
  const botPending = detail.opponentIsBot && view.pending.includes(view.you === 0 ? 1 : 0);

  useEffect(() => {
    if (!botPending || view.phase === "complete") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const response = await fetch(`/api/games/${initial.id}/bot`, {
          method: "POST",
        });
        if (!response.ok || cancelled) return;
        applyDetail((await response.json()) as GameDetail);
      } catch {
        /* the poll will pick the game back up */
      } finally {
        inFlight.current = false;
      }
    }, BOT_THINK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyDetail, botPending, initial.id, view.phase, detail.version]);

  // --- reactions to state changes ----------------------------------------

  // A score change pops the number and floats the delta off the board.
  useEffect(() => {
    const before = scoresRef.current;
    const after = view.scores;
    if (before[0] !== after[0] || before[1] !== after[1]) {
      const seat: Seat = after[0] > before[0] ? 0 : 1;
      const delta = after[seat] - before[seat];
      scoresRef.current = after;
      if (delta > 0) {
        const key = Date.now();
        setBump({ seat, delta, key });
        const timer = window.setTimeout(() => setBump(null), BUMP_MS);
        return () => window.clearTimeout(timer);
      }
    }
    scoresRef.current = after;
  }, [view.scores]);

  // A fresh deal sends the hand flying in from the deck.
  useEffect(() => {
    if (handRef.current !== view.handNumber) {
      handRef.current = view.handNumber;
      setDealing(true);
      // Cards are reshuffled, so a remembered position is meaningless — and
      // the same card code could reappear and fly from the wrong place.
      setFlight(null);
      setCribFlight(null);
    }
  }, [view.handNumber]);

  useEffect(() => {
    if (!dealing) return;
    const timer = window.setTimeout(() => setDealing(false), 1100);
    return () => window.clearTimeout(timer);
  }, [dealing]);

  // Light sweeps the felt when the board becomes yours again.
  useEffect(() => {
    if (view.isYourTurn && !wasYourTurn.current) {
      setTurnArrival((n) => n + 1);
    }
    wasYourTurn.current = view.isYourTurn;
  }, [view.isYourTurn]);

  // Tell a backgrounded tab that it is your move.
  useEffect(() => {
    const base = "Cribbage";
    document.title =
      view.isYourTurn && view.phase !== "complete" ? `● Your turn — ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [view.isYourTurn, view.phase]);

  // --- moves --------------------------------------------------------------

  const submit = useCallback(
    async (move: MoveRequest) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/games/${initial.id}/move`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...move, version: detail.version }),
        });
        const body = await response.json();
        if (!response.ok) {
          setError(body.error ?? "That move was not accepted.");
          // A conflict means our view is stale; pull the real state.
          if (response.status === 409) void refresh();
          return;
        }
        setFreshAfter(detailRef.current.log.at(-1)?.seq ?? -1);
        setDetail(body as GameDetail);
        setSelected([]);
      } catch {
        setError("Could not reach the server. Check your connection.");
      } finally {
        setBusy(false);
      }
    },
    [detail.version, initial.id, refresh],
  );

  const toggle = (card: Card) => {
    setError(null);
    setSelected((current) => {
      if (current.includes(card)) return current.filter((c) => c !== card);
      if (view.phase === "discard") {
        return current.length >= 2 ? [current[1]!, card] : [...current, card];
      }
      return [card];
    });
  };

  // --- derived ------------------------------------------------------------

  const isDiscard = view.phase === "discard" && view.isYourTurn;
  const isPegging = view.phase === "pegging" && view.isYourTurn;
  const isCounting = view.phase === "counting" && view.isYourTurn;
  const gameOver = view.phase === "complete";

  const playable = new Set(view.legalPlays);
  /** Only offer the hand as controls when there is actually a choice to make. */
  const interactive = isDiscard || isPegging;

  const counting = view.phase === "counting";
  const countingCrib = counting && view.countIndex === 2;

  // While counting, show exactly what is being counted — the four cards plus
  // the cut — so the player can add it up without looking in two places.
  const baseCards =
    countingCrib && view.crib
      ? view.crib
      : view.phase === "pegging"
        ? view.unplayed
        : view.hand;
  const handCards =
    counting && view.starter ? [...baseCards, view.starter] : baseCards;
  const handLabel = countingCrib
    ? "Your crib and the cut"
    : counting
      ? "Your hand and the cut"
      : "Your hand";

  const selectable = (card: Card) => {
    if (busy) return false;
    if (isDiscard) return true;
    if (isPegging) return playable.has(card);
    return false;
  };

  return (
    <div className="stack">
      {/* The visible heading is the turn banner; screen readers get the match
          itself as the page's level-one heading. */}
      <h1 className="sr-only">
        Cribbage against {opponentName}
        {view.handNumber > 0 ? `, hand ${view.handNumber}` : ""}
      </h1>

      <div
        className={`banner${gameOver ? " banner--over" : view.isYourTurn ? " banner--turn" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className={`pulse${view.isYourTurn && !gameOver ? "" : " pulse--idle"}`} />
        <span className="banner-text">{view.prompt}</span>
        <span className="spacer" />
        {!gameOver && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void refresh()}
            disabled={busy}
          >
            Refresh
          </button>
        )}
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {detail.inviteUrl && (
        <div className="panel panel-pad stack-sm invite-panel">
          <h2>Invite your opponent</h2>
          <p className="small muted">
            Text them this link. They tap it, pick a name, and the first hand
            is dealt — no account, no app.
          </p>
          <InviteLink url={detail.inviteUrl} />
        </div>
      )}

      <div className="game-grid">
        <div className="stack">
          <div className="board-shell">
            <CribbageBoard
              names={names}
              scores={view.scores}
              prevScores={view.prevScores}
              you={view.you}
              target={view.target}
              winnerSeat={view.winnerSeat}
              bumped={bump?.seat ?? null}
            />
            {bump && <Burst key={`burst-${bump.key}`} seat={bump.seat} points={bump.delta} />}
            {bump && (
              <span
                key={bump.key}
                className="score-float"
                style={{ color: bump.seat === 0 ? "var(--p0-light)" : "var(--p1-light)" }}
                aria-hidden="true"
              >
                +{bump.delta}
              </span>
            )}
          </div>

          <section className="table stack" aria-label="Table">
            {view.isYourTurn && !gameOver && (
              <span key={turnArrival} className="table-sheen" aria-hidden="true" />
            )}
            {/* Starter and running count bracket the table; the play gets a
                full-width row of its own so eight cards never wrap awkwardly
                around them on a phone. */}
            <div className="table-row">
              <div className="stack-sm">
                <span className="table-label">Starter</span>
                {view.starter ? (
                  <div className="flip" key={view.starter}>
                    <div className="flip-inner">
                      <div className="flip-face">
                        <PlayingCard card={view.starter} starter />
                      </div>
                      {/* The reverse of the flip: decoration, not a second card. */}
                      <div className="flip-face flip-face--back" aria-hidden="true">
                        <CardBack />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="pcard-slot" />
                )}
              </div>

              {view.phase !== "awaiting_opponent" && (
                <div className="stack-sm">
                  <span className="table-label">Deck</span>
                  <div className="deck" aria-hidden="true">
                    <span className="deck-card" />
                    <span className="deck-card" />
                    <span className="deck-card" />
                  </div>
                </div>
              )}

              <span className="spacer" />

              {view.phase === "pegging" && <CountChip total={view.play.total} />}
            </div>

            <div className="stack-sm">
              <div className="row" style={{ gap: 10 }}>
                <span className="table-label">The play</span>
                {view.phase === "pegging" &&
                  ([0, 1] as Seat[])
                    .filter((seat) => view.play.goSaid[seat])
                    .map((seat) => (
                      <span key={seat} className="go-chip">
                        {seat === view.you ? "You said" : `${names[seat]} said`} “go”
                      </span>
                    ))}
              </div>
              <PlayArea view={view} names={names} flight={flight} />
            </div>

            <div className="table-row">
              <div className="stack-sm">
                <span className="table-label">
                  {view.youAreDealer ? "Your crib" : `${names[view.dealer]}'s crib`}
                </span>
                <div className="card-strip card-strip--tight card-pile">
                  {view.crib
                    ? view.crib.map((card, i) => (
                        <span key={card} style={pileTilt(i)}>
                          <PlayingCard card={card} size="sm" />
                        </span>
                      ))
                    : Array.from({ length: view.cribSize }, (_, i) => (
                        // Only cards added after this player's own discard.
                        <CribCard
                          key={i}
                          tilt={pileTilt(i)}
                          flight={
                            cribFlight && i >= cribFlight.from
                              ? (cribFlight.cards[i - cribFlight.from] ?? null)
                              : null
                          }
                        />
                      ))}
                  {view.cribSize === 0 && !view.crib && (
                    <span className="small" style={{ opacity: 0.55 }}>
                      empty
                    </span>
                  )}
                </div>
              </div>

              <div className="stack-sm">
                <span className="table-label">{names[view.you === 0 ? 1 : 0]}</span>
                <div className="card-strip card-strip--tight card-held">
                  {view.opponentHand
                    ? view.opponentHand.map((card, i) => (
                        <span key={card} style={heldTilt(i, view.opponentHand!.length)}>
                          <PlayingCard card={card} size="sm" />
                        </span>
                      ))
                    : Array.from({ length: view.opponentCardCount }, (_, i) => (
                        <span key={i} style={heldTilt(i, view.opponentCardCount)}>
                          <CardBack size="sm" />
                        </span>
                      ))}
                  {view.opponentCardCount === 0 && !view.opponentHand && (
                    <span className="small" style={{ opacity: 0.55 }}>
                      no cards
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="panel panel-pad stack-sm" aria-label={handLabel}>
            <div className="row">
              <span className="panel-title">{handLabel}</span>
              {isDiscard && (
                <span className="small muted">
                  {selected.length}/2 selected for the crib
                </span>
              )}
            </div>

            {handCards.length === 0 ? (
              <p className="small muted">
                {view.phase === "pegging"
                  ? "You have played all your cards."
                  : "Waiting for the next deal."}
              </p>
            ) : (
              <div className="hand">
                {handCards.map((card, index) => {
                  // Splay the cards around the middle of the hand, the way
                  // they sit when you actually hold them.
                  const middle = (handCards.length - 1) / 2;
                  const fan = {
                    "--angle": `${(index - middle) * 5}deg`,
                    "--arc": `${(index - middle) ** 2 * 2.4}px`,
                    "--i": index,
                  } as React.CSSProperties;

                  const label = `${cardName(card)}${
                    isPegging && !playable.has(card)
                      ? " — would take the count past 31"
                      : ""
                  }`;

                  return interactive ? (
                    <button
                      key={card}
                      type="button"
                      className={`hand-card${dealing ? " hand-card--dealing" : ""}`}
                      style={fan}
                      data-card={card}
                      data-selected={selected.includes(card)}
                      disabled={!selectable(card)}
                      aria-pressed={selected.includes(card)}
                      aria-label={label}
                      onClick={() => toggle(card)}
                    >
                      <PlayingCard card={card} />
                    </button>
                  ) : (
                    // Nothing to choose right now — show the cards, do not
                    // offer a row of dead buttons.
                    <span
                      key={card}
                      className={`hand-card${dealing ? " hand-card--dealing" : ""}`}
                      style={fan}
                    >
                      <PlayingCard card={card} starter={counting && card === view.starter} />
                    </span>
                  );
                })}
              </div>
            )}

            <ActionBar
              busy={busy}
              isDiscard={isDiscard}
              isPegging={isPegging}
              isCounting={isCounting}
              countLabel={view.countLabel}
              selected={selected}
              onDiscard={() => {
                const cards = [selected[0]!, selected[1]!] as [Card, Card];
                setCribFlight({
                  from: view.cribSize,
                  cards: cards
                    .map((card) => captureFlight(card))
                    .filter((f): f is CardFlight => f !== null),
                });
                void submit({ type: "discard", cards });
              }}
              onPlay={() => {
                const card = selected[0]!;
                setFlight(captureFlight(card));
                void submit({ type: "play", card });
              }}
              onCount={() => void submit({ type: "count" })}
            />
          </section>

          {gameOver && view.winnerSeat !== null && (
            <>
              {view.winnerSeat === view.you && <Confetti seat={view.you} />}
              <div className="panel winner-card stack-sm">
                <span className="table-label">
                  {marginLabel(view.scores, view.winnerSeat)}
                </span>
                <h2 className="winner-title">
                  {view.winnerSeat === view.you
                    ? "You won."
                    : `${names[view.winnerSeat]} took it.`}
                </h2>
                <p className="winner-score">
                  {view.scores[view.winnerSeat]}–
                  {view.scores[view.winnerSeat === 0 ? 1 : 0]}
                </p>
                <div className="row-wrap" style={{ justifyContent: "center", marginTop: 10 }}>
                  <Link className="btn btn-primary" href="/games">
                    Back to your games
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>

        <aside className="game-side">
          <div className="panel panel--clip">
            <div className="panel-head">
              <span className="panel-title">History</span>
            </div>
            <HistoryLog log={detail.log} freshAfter={freshAfter} />
          </div>
        </aside>
      </div>

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            {withCardChips(toast.text)}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- sub-components --------------------------------------------------------

/** A face-down card in the crib, flown from wherever it left the hand. */
function CribCard({
  flight,
  tilt,
}: {
  flight: CardFlight | null;
  tilt: React.CSSProperties;
}) {
  const ref = useFlyFrom<HTMLSpanElement>(flight);
  return (
    <span ref={ref} style={tilt}>
      <CardBack size="sm" />
    </span>
  );
}

/**
 * Cards laid away land in a pile, not a row. The tilt is derived from the
 * index rather than random, so it does not reshuffle on every render.
 */
function pileTilt(index: number): React.CSSProperties {
  const angles = [-4, 2.5, -1.5, 5, -3];
  return { "--tilt": `${angles[index % angles.length]}deg` } as React.CSSProperties;
}

/** A held hand splays gently around its middle. */
function heldTilt(index: number, count: number): React.CSSProperties {
  const middle = (count - 1) / 2;
  return { "--tilt": `${(index - middle) * 4}deg` } as React.CSSProperties;
}

/** Where a card was on screen when it left the hand. */
interface CardFlight {
  card: Card;
  left: number;
  top: number;
  width: number;
}

/**
 * Measures a card in the hand before it is played, so the copy that appears on
 * the table can be animated back to that spot and then flown into place.
 * Returns null if the element cannot be found — the card simply appears.
 */
function captureFlight(card: Card): CardFlight | null {
  if (typeof document === "undefined") return null;
  const element = document.querySelector(`[data-card="${CSS.escape(card)}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { card, left: rect.left, top: rect.top, width: rect.width };
}

/**
 * Animates an element from where a card used to be to where it now is.
 *
 * The measurement happens in a layout effect, in the same frame as the
 * element's first paint, so nothing flickers between the two positions. It
 * runs once per element and not at all under prefers-reduced-motion.
 */
function useFlyFrom<T extends HTMLElement>(origin: CardFlight | null) {
  const ref = useRef<T>(null);
  const reduced = usePrefersReducedMotion();
  const flown = useRef(false);

  useLayoutEffect(() => {
    if (!origin || flown.current || reduced) return;
    const element = ref.current;
    if (!element) return;

    const now = element.getBoundingClientRect();
    if (now.width === 0) return;
    flown.current = true;

    element.animate(
      [
        {
          transform: `translate(${origin.left - now.left}px, ${origin.top - now.top}px) scale(${origin.width / now.width})`,
          opacity: 0.9,
        },
        { transform: "none", opacity: 1 },
      ],
      { duration: 460, easing: "cubic-bezier(0.22, 0.75, 0.28, 1)" },
    );
  }, [origin, reduced]);

  return ref;
}

/**
 * One card on the table. When it is the card that was just played, it starts
 * from where it sat in the hand and travels to its place in the row — the
 * gesture of laying a card down, rather than one blinking into existence.
 */
function PlayedCard({
  played,
  current,
  owner,
  ownerName,
  flight,
}: {
  played: PlayedCardState;
  current: boolean;
  owner: string;
  ownerName: string;
  flight: CardFlight | null;
}) {
  const ref = useFlyFrom<HTMLDivElement>(flight);

  return (
    <div ref={ref} className={`played${current ? " played--current" : ""}`}>
      <PlayingCard card={played.card} size="sm" laid={!flight} />
      <span className="played-owner" style={{ background: owner }} aria-hidden="true" />
      <span
        className="played-total"
        title={`${ownerName} — running total ${played.total}`}
      >
        {played.total}
      </span>
    </div>
  );
}

/**
 * The running count, rolled rather than snapped: watching 22 climb to 27 is
 * how you read what just happened without going to the log.
 */
function CountChip({ total }: { total: number }) {
  const shown = useCountUp(total);
  const [pop, setPop] = useState(false);
  const previous = useRef(total);

  useEffect(() => {
    if (previous.current === total) return;
    previous.current = total;
    setPop(true);
    const timer = window.setTimeout(() => setPop(false), 470);
    return () => window.clearTimeout(timer);
  }, [total]);

  return (
    <div
      className={`count-chip${pop ? " count-chip--bump" : ""}`}
      aria-label={`The count is ${total}`}
    >
      <span className="count-chip-value" aria-hidden="true">
        {shown}
      </span>
      <span className="count-chip-label">count</span>
    </div>
  );
}

/** Cribbage names the margin: under 91 is a skunk, under 61 a double skunk. */
function marginLabel(scores: [number, number], winner: Seat): string {
  const loser = scores[winner === 0 ? 1 : 0];
  if (loser < 61) return "Double skunk";
  if (loser < 91) return "Skunk";
  return "Game";
}

/**
 * The cards laid this hand. The current run up to 31 is highlighted; earlier
 * runs stay visible but muted, so you can read the whole hand's play.
 */
function PlayArea({
  view,
  names,
  flight,
}: {
  view: GameDetail["view"];
  names: [string, string];
  flight: CardFlight | null;
}) {
  const history = view.play.history;
  if (history.length === 0) {
    return (
      <p className="small" style={{ opacity: 0.58 }}>
        {view.phase === "discard"
          ? "Cards go down once both players have discarded."
          : "No cards played yet."}
      </p>
    );
  }

  const currentFrom = history.length - view.play.sequence.length;
  const lastIndex = history.length - 1;

  return (
    <div className="card-strip card-strip--tight">
      {history.map((played, index) => (
        <PlayedCard
          key={`${played.card}-${index}`}
          played={played}
          current={index >= currentFrom}
          owner={played.seat === 0 ? "var(--p0)" : "var(--p1)"}
          ownerName={names[played.seat]}
          // Only the card that just left this player's hand flies.
          flight={
            index === lastIndex && flight?.card === played.card ? flight : null
          }
        />
      ))}
    </div>
  );
}

function ActionBar({
  busy,
  isDiscard,
  isPegging,
  isCounting,
  countLabel,
  selected,
  onDiscard,
  onPlay,
  onCount,
}: {
  busy: boolean;
  isDiscard: boolean;
  isPegging: boolean;
  isCounting: boolean;
  countLabel: string | null;
  selected: Card[];
  onDiscard: () => void;
  onPlay: () => void;
  onCount: () => void;
}) {
  const spinner = <span className="spinner" aria-hidden="true" />;

  if (isDiscard) {
    return (
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy || selected.length !== 2}
        onClick={onDiscard}
      >
        {busy && spinner}
        {selected.length === 2
          ? `Lay away ${selected.map((c) => cardLabel(c)).join(" and ")}`
          : "Select two cards for the crib"}
      </button>
    );
  }

  if (isPegging) {
    return (
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy || selected.length !== 1}
        onClick={onPlay}
      >
        {busy && spinner}
        {selected.length === 1
          ? `Play ${cardLabel(selected[0]!)}`
          : "Select a card to play"}
      </button>
    );
  }

  if (isCounting) {
    return (
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={onCount}
      >
        {busy && spinner}
        {countLabel === "crib" ? "Count the crib" : "Count my hand"}
      </button>
    );
  }

  return null;
}

/**
 * The moment the whole app hinges on: getting the link to the other person.
 *
 * On a phone the native share sheet is the shortest path from here to a text
 * message, so it leads when the browser offers it. Copying is the fallback and
 * the desktop path, and the raw link is always visible for anyone who would
 * rather select it themselves.
 */
function InviteLink({ url }: { url: string }) {
  const isClient = useIsClient();
  const [copied, setCopied] = useState(false);
  const canShare =
    isClient && typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "Cribbage",
        text: "Fancy a game of cribbage? Tap this and you are in.",
        url,
      });
    } catch {
      // The share sheet was dismissed; nothing to report.
    }
  }

  return (
    <div className="stack-sm">
      <div className="row-wrap">
        {canShare && (
          <button type="button" className="btn btn-primary" onClick={() => void share()}>
            <ShareIcon />
            Send the invite
          </button>
        )}
        <button
          type="button"
          className={canShare ? "btn" : "btn btn-primary"}
          onClick={() => void copy()}
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      <code className="invite-code">{url}</code>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}
