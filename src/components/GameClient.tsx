"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { GameDetail, MoveRequest } from "@/lib/api-types";
import {
  type Card,
  type PlayedCard as PlayedCardState,
  cardLabel,
  reactionFor,
  reactionsWithTone,
} from "@/lib/cribbage";
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
  // `seat` here is a scoring track: in a partnership game two people share one.
  const [bump, setBump] = useState<{ seat: number; delta: number; key: number } | null>(
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
  // Seeded from the first payload so opening the game does not replay every
  // thing already said in it.
  const seenTalk = useRef(new Set(initial.reactions.map((entry) => entry.id)));
  const [saying, setSaying] = useState<string | null>(null);
  const wasYourTurn = useRef(detail.view.isYourTurn);

  const router = useRouter();
  const { view } = detail;
  const names = detail.table.map(
    (entry, seat) => entry.name ?? `Player ${seat + 1}`,
  );
  // With three or four at the table there is no single "opponent", so the
  // heading names everyone rather than pretending there is one of them.
  const seatedOthers = detail.table.filter(
    (entry) => entry.seat !== view.you && entry.name,
  );
  const opponentName =
    seatedOthers.length === 0
      ? "an opponent yet to join"
      : seatedOthers.length === 1
        ? seatedOthers[0]!.name!
        : seatedOthers.map((entry) => entry.name).join(", ");

  /** Chairs still waiting on somebody. */
  const seatsToFill = detail.table.filter((entry) => !entry.name).length;

  /** One peg per scoring track: per player, or per partnership. */
  const tracks = view.scores.map((score, track) => {
    const members = detail.table.filter(
      (entry) => entry.name && trackOfSeat(view, entry.seat) === track,
    );
    return {
      name: members.map((entry) => entry.name).join(" & ") || `Side ${track + 1}`,
      score,
      prevScore: view.prevScores[track] ?? score,
      yours: track === view.yourTrack,
      won: view.winnerTrack === track,
    };
  });

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
      if (next.version < current.version) return;

      // Table talk deliberately does not bump the version — that is what keeps
      // it from colliding with a move. The cost is that a poll carrying only
      // new talk looks like no news at all, so it has to be recognised here or
      // the other player's line is dropped on the floor and never seen.
      const known = new Set(current.reactions.map((entry) => entry.id));
      const newTalk = next.reactions.some((entry) => !known.has(entry.id));
      if (next.version === current.version && !newTalk) return;

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

  // Table talk arrives on the same poll as everything else. Only the other
  // side's is announced — you know what you just said.
  useEffect(() => {
    for (const entry of detail.reactions) {
      if (seenTalk.current.has(entry.id)) continue;
      seenTalk.current.add(entry.id);
      if (entry.seat === view.you) continue;
      const reaction = reactionFor(entry.key);
      if (reaction) pushToast(`${opponentName}: ${reaction.text}`);
    }
  }, [detail.reactions, opponentName, pushToast, view.you]);

  /** Deals the next game between the same people and goes straight to it. */
  const rematch = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${initial.id}/rematch`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not start another game.");
        return;
      }
      router.push(`/games/${body.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [initial.id, router]);

  const say = useCallback(
    async (key: string) => {
      setSaying(key);
      try {
        const response = await fetch(`/api/games/${initial.id}/react`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          pushToast(body.error ?? "That did not send.");
          return;
        }
        const next = (await response.json()) as GameDetail;
        // Your own line is not announced back to you, so mark it seen first.
        for (const entry of next.reactions) seenTalk.current.add(entry.id);
        setDetail(next);
      } catch {
        pushToast("That did not send.");
      } finally {
        setSaying(null);
      }
    },
    [initial.id, pushToast],
  );

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
    const moved = after.findIndex((score, track) => score !== (before[track] ?? 0));
    if (moved !== -1) {
      const delta = after[moved]! - (before[moved] ?? 0);
      scoresRef.current = after;
      if (delta > 0) {
        const key = Date.now();
        setBump({ seat: moved, delta, key });
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
        // Three- and four-handed games owe the crib a single card, so a second
        // tap replaces the first rather than adding to it.
        const owed = view.discardsOwed;
        return current.length >= owed
          ? [...current.slice(current.length - owed + 1), card]
          : [...current, card];
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
          <h2>
            {seatsToFill === 1 ? "Invite your opponent" : `Invite ${seatsToFill} players`}
          </h2>
          <p className="small muted">
            {seatsToFill === 1
              ? "Text them this link. They tap it, pick a name, and the first hand is dealt — no account, no app."
              : `Send the same link to everyone. Each one taps it and picks a name; the cards are dealt once all ${detail.table.length} seats are taken.`}
          </p>
          <InviteLink url={detail.inviteUrl} />
        </div>
      )}

      <div className="game-grid">
        <div className="stack">
          <div className="board-shell">
            <CribbageBoard
              tracks={tracks}
              target={view.target}
              bumped={bump?.seat ?? null}
            />
            {bump && <Burst key={`burst-${bump.key}`} seat={bump.seat} points={bump.delta} />}
            {bump && (
              <span
                key={bump.key}
                className="score-float"
                style={{ color: `var(--p${bump.seat}-light)` }}
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
                  names
                    .map((_, seat) => seat)
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

              {view.opponents.map((other) => (
                <div className="stack-sm" key={other.seat}>
                  <span className="table-label">
                    <span
                      className="peg-dot peg-dot--inline"
                      style={{ background: `var(--p${other.track})` }}
                    />
                    {other.name}
                    {other.isPartner ? " (partner)" : ""}
                  </span>
                  <div className="card-strip card-strip--tight card-held">
                    {other.hand
                      ? other.hand.map((card, i) => (
                          <span key={card} style={heldTilt(i, other.hand!.length)}>
                            <PlayingCard card={card} size="sm" />
                          </span>
                        ))
                      : Array.from({ length: other.cardCount }, (_, i) => (
                          <span key={i} style={heldTilt(i, other.cardCount)}>
                            <CardBack size="sm" />
                          </span>
                        ))}
                    {other.cardCount === 0 && !other.hand && (
                      <span className="small" style={{ opacity: 0.55 }}>
                        no cards
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel panel-pad stack-sm" aria-label={handLabel}>
            <div className="row">
              <span className="panel-title">{handLabel}</span>
              {isDiscard && (
                <span className="small muted">
                  {selected.length}/{view.discardsOwed} selected for the crib
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
              discardsOwed={view.discardsOwed}
              onDiscard={() => {
                const cards = selected.slice(0, view.discardsOwed);
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
              {view.winnerTrack === view.yourTrack && (
                <Confetti seat={view.yourTrack} />
              )}
              <div className="panel winner-card stack-sm">
                <span className="table-label">
                  {marginLabel(view.scores, view.winnerTrack ?? 0)}
                </span>
                <h2 className="winner-title">
                  {view.winnerSeat === view.you
                    ? "You won."
                    : `${names[view.winnerSeat]} took it.`}
                </h2>
                <p className="winner-score">
                  {view.scores[view.winnerTrack ?? 0]}–
                  {Math.max(
                    0,
                    ...view.scores.filter((_, track) => track !== view.winnerTrack),
                  )}
                </p>
                {detail.rivalry && detail.rivalry.played > 0 && (
                  <SeriesRecord rivalry={detail.rivalry} />
                )}
                <div className="row-wrap" style={{ justifyContent: "center", marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void rematch()}
                    disabled={busy}
                  >
                    {busy ? "Dealing…" : "Play again"}
                  </button>
                  <Link className="btn" href="/games">
                    Back to your games
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>

        <aside className="game-side">
          {detail.rivalry && detail.rivalry.played > 0 && !gameOver && (
            <div className="panel panel-pad">
              <SeriesRecord rivalry={detail.rivalry} compact />
            </div>
          )}
          {detail.opponent && (
            <TableTalk onSay={say} saying={saying} disabled={saying !== null} />
          )}
          <div className="panel panel--clip">
            <div className="panel-head">
              <span className="panel-title">History</span>
            </div>
            <HistoryLog
              log={detail.log}
              reactions={detail.reactions}
              names={names}
              tracks={names.map((_, seat) => trackOfSeat(view, seat))}
              freshAfter={freshAfter}
            />
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

/**
 * Two rows of one-tap table talk.
 *
 * Says nothing about the game and scores nothing; it exists because half of
 * cribbage is what gets said over the board, and playing a hand a day apart
 * loses all of it.
 */
function TableTalk({
  onSay,
  saying,
  disabled,
}: {
  onSay: (key: string) => void;
  saying: string | null;
  disabled: boolean;
}) {
  return (
    <div className="panel talk">
      <div className="panel-head">
        <span className="panel-title">Say something</span>
      </div>
      <div className="talk-body">
        {(["jab", "props"] as const).map((tone) => (
          <div className="talk-row" key={tone}>
            {reactionsWithTone(tone).map((reaction) => (
              <button
                key={reaction.key}
                type="button"
                className={`talk-chip talk-chip--${tone}`}
                onClick={() => onSay(reaction.key)}
                disabled={disabled}
                aria-busy={saying === reaction.key}
              >
                {reaction.text}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The running score between these people.
 *
 * Counted from finished games rather than a stored tally, so it is right
 * retroactively — games played before anyone was keeping track are in it.
 */
function SeriesRecord({
  rivalry,
  compact = false,
}: {
  rivalry: NonNullable<GameDetail["rivalry"]>;
  compact?: boolean;
}) {
  return (
    <div className={`series${compact ? " series--compact" : ""}`}>
      <span className="table-label">
        {rivalry.played === 1 ? "1 game played" : `${rivalry.played} games played`}
      </span>
      <div className="series-rows">
        {rivalry.standings.map((standing) => (
          <div className="series-row" key={standing.userId}>
            <span className="series-name">{standing.name}</span>
            <span className="series-wins">{standing.wins}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Which peg a seat pushes. The view names the viewer's own track and each
 * opponent's, which between them covers the table.
 */
function trackOfSeat(view: GameDetail["view"], seat: number): number {
  if (seat === view.you) return view.yourTrack;
  return view.opponents.find((other) => other.seat === seat)?.track ?? seat;
}

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

/**
 * Cribbage names the margin: under 91 is a skunk, under 61 a double skunk.
 * With three at the table the margin is measured against whoever came closest.
 */
function marginLabel(scores: number[], winnerTrack: number): string {
  const best = Math.max(
    0,
    ...scores.filter((_, track) => track !== winnerTrack),
  );
  if (best < 61) return "Double skunk";
  if (best < 91) return "Skunk";
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
  names: string[];
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
  discardsOwed,
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
  discardsOwed: number;
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
        disabled={busy || selected.length !== discardsOwed}
        onClick={onDiscard}
      >
        {busy && spinner}
        {selected.length === discardsOwed
          ? `Lay away ${selected.map((c) => cardLabel(c)).join(" and ")}`
          : discardsOwed === 1
            ? "Select a card for the crib"
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
