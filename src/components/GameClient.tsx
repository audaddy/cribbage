"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { GameDetail, MoveRequest } from "@/lib/api-types";
import { type Card, type Seat, cardLabel } from "@/lib/cribbage";
import { CribbageBoard } from "./CribbageBoard";
import { HistoryLog } from "./HistoryLog";
import { CardBack, PlayingCard, cardName } from "./PlayingCard";

/** Poll faster while waiting on the opponent than while the board is yours. */
const POLL_WAITING_MS = 6000;
const POLL_ACTIVE_MS = 20000;
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
  const [countBump, setCountBump] = useState(0);
  /** Log seq at the moment of the last update; anything above it is new. */
  const [freshAfter, setFreshAfter] = useState<number | null>(null);

  const inFlight = useRef(false);
  const detailRef = useRef(detail);
  const scoresRef = useRef(detail.view.scores);
  const totalRef = useRef(detail.view.play.total);
  const toastId = useRef(0);

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

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(`/api/games/${initial.id}`, { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as GameDetail;
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
    } catch {
      /* offline or transient — the next tick will retry */
    } finally {
      inFlight.current = false;
    }
  }, [initial.id, pushToast]);

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

  // The running count pulses whenever it moves.
  useEffect(() => {
    if (totalRef.current !== view.play.total) {
      totalRef.current = view.play.total;
      setCountBump((n) => n + 1);
    }
  }, [view.play.total]);

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

  const handCards = view.phase === "pegging" ? view.unplayed : view.hand;
  const playable = new Set(view.legalPlays);
  /** Only offer the hand as controls when there is actually a choice to make. */
  const interactive = isDiscard || isPegging;

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
        <div className="panel panel-pad stack-sm">
          <h2>Invite your opponent</h2>
          <p className="small muted">
            Send this link. The game starts as soon as they open it.
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
            {/* Starter and running count bracket the table; the play gets a
                full-width row of its own so eight cards never wrap awkwardly
                around them on a phone. */}
            <div className="table-row">
              <div className="stack-sm">
                <span className="table-label">Starter</span>
                {view.starter ? (
                  <PlayingCard card={view.starter} starter />
                ) : (
                  <div className="pcard-slot" />
                )}
              </div>

              <span className="spacer" />

              {view.phase === "pegging" && (
                <div
                  key={countBump}
                  className="count-chip count-chip--bump"
                  aria-label={`The count is ${view.play.total}`}
                >
                  <span className="count-chip-value">{view.play.total}</span>
                  <span className="count-chip-label">count</span>
                </div>
              )}
            </div>

            <div className="stack-sm">
              <span className="table-label">The play</span>
              <PlayArea view={view} names={names} />
            </div>

            <div className="table-row">
              <div className="stack-sm">
                <span className="table-label">
                  {view.youAreDealer ? "Your crib" : `${names[view.dealer]}'s crib`}
                </span>
                <div className="card-strip card-strip--tight">
                  {view.crib
                    ? view.crib.map((card) => (
                        <PlayingCard key={card} card={card} size="sm" />
                      ))
                    : Array.from({ length: view.cribSize }, (_, i) => (
                        <CardBack key={i} size="sm" />
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
                <div className="card-strip card-strip--tight">
                  {view.opponentHand
                    ? view.opponentHand.map((card) => (
                        <PlayingCard key={card} card={card} size="sm" />
                      ))
                    : Array.from({ length: view.opponentCardCount }, (_, i) => (
                        <CardBack key={i} size="sm" />
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

          <section className="panel panel-pad stack-sm" aria-label="Your hand">
            <div className="row">
              <span className="panel-title">Your hand</span>
              {isDiscard && (
                <span className="small muted">
                  {selected.length}/2 selected for the crib
                </span>
              )}
            </div>

            <div className="card-strip">
              {handCards.length === 0 && (
                <p className="small muted">
                  {view.phase === "pegging"
                    ? "You have played all your cards."
                    : "Waiting for the next deal."}
                </p>
              )}
              {handCards.map((card, index) =>
                interactive ? (
                  <button
                    key={card}
                    type="button"
                    className="pcard-button"
                    data-selected={selected.includes(card)}
                    disabled={!selectable(card)}
                    aria-pressed={selected.includes(card)}
                    aria-label={`${cardName(card)}${
                      isPegging && !playable.has(card)
                        ? " — would take the count past 31"
                        : ""
                    }`}
                    onClick={() => toggle(card)}
                  >
                    <PlayingCard card={card} dealIndex={index} />
                  </button>
                ) : (
                  // Nothing to choose right now — show the cards, do not offer
                  // a row of dead buttons.
                  <PlayingCard key={card} card={card} dealIndex={index} />
                ),
              )}
            </div>

            <ActionBar
              busy={busy}
              isDiscard={isDiscard}
              isPegging={isPegging}
              isCounting={isCounting}
              countLabel={view.countLabel}
              selected={selected}
              onDiscard={() =>
                void submit({
                  type: "discard",
                  cards: [selected[0]!, selected[1]!] as [string, string],
                })
              }
              onPlay={() => void submit({ type: "play", card: selected[0]! })}
              onCount={() => void submit({ type: "count" })}
            />
          </section>

          {gameOver && (
            <div className="panel panel-pad row-wrap">
              <span className="banner-text">
                {view.winnerSeat === view.you
                  ? "You won this one."
                  : `${names[view.winnerSeat ?? 0]} took it.`}
              </span>
              <span className="spacer" />
              <Link className="btn" href="/games">
                Back to your games
              </Link>
            </div>
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
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- sub-components --------------------------------------------------------

/**
 * The cards laid this hand. The current run up to 31 is highlighted; earlier
 * runs stay visible but muted, so you can read the whole hand's play.
 */
function PlayArea({
  view,
  names,
}: {
  view: GameDetail["view"];
  names: [string, string];
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

  return (
    <div className="card-strip card-strip--tight">
      {history.map((played, index) => (
        <div
          key={`${played.card}-${index}`}
          className={`played${index >= currentFrom ? " played--current" : ""}`}
        >
          <PlayingCard card={played.card} size="sm" laid />
          <span
            className="played-total"
            title={`${names[played.seat]} — running total ${played.total}`}
          >
            {played.total}
          </span>
        </div>
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
  if (isDiscard) {
    return (
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy || selected.length !== 2}
        onClick={onDiscard}
      >
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
        {countLabel === "crib" ? "Count the crib" : "Count my hand"}
      </button>
    );
  }

  return null;
}

function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row-wrap">
      <code className="invite-code" style={{ flex: 1 }}>
        {url}
      </code>
      <button
        type="button"
        className="btn btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
