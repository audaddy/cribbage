"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { GameDetail, MoveRequest } from "@/lib/api-types";
import { type Card, cardLabel } from "@/lib/cribbage";
import { CribbageBoard } from "./CribbageBoard";
import { HistoryLog } from "./HistoryLog";
import { CardBack, PlayingCard, cardName } from "./PlayingCard";

/** Poll faster while waiting on the opponent than while the board is yours. */
const POLL_WAITING_MS = 6000;
const POLL_ACTIVE_MS = 20000;

export function GameClient({ initial }: { initial: GameDetail }) {
  const [detail, setDetail] = useState(initial);
  const [selected, setSelected] = useState<Card[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const { view } = detail;
  const names: [string, string] =
    view.you === 0
      ? [detail.you.name, detail.opponent?.name ?? "Opponent"]
      : [detail.opponent?.name ?? "Opponent", detail.you.name];

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(`/api/games/${initial.id}`, {
        cache: "no-store",
      });
      if (response.ok) {
        const next = (await response.json()) as GameDetail;
        // Never clobber a newer local state with a stale poll response.
        setDetail((current) => (next.version >= current.version ? next : current));
      }
    } catch {
      /* offline or transient — the next tick will retry */
    } finally {
      inFlight.current = false;
    }
  }, [initial.id]);

  // Poll for the opponent's moves, and refresh whenever the tab regains focus.
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

  // --- derived UI state ---------------------------------------------------

  const isDiscard = view.phase === "discard" && view.isYourTurn;
  const isPegging = view.phase === "pegging" && view.isYourTurn;
  const isCounting = view.phase === "counting" && view.isYourTurn;
  const gameOver = view.phase === "complete";

  const handCards = view.phase === "pegging" ? view.unplayed : view.hand;
  const playable = new Set(view.legalPlays);

  const selectable = (card: Card) => {
    if (busy) return false;
    if (isDiscard) return true;
    if (isPegging) return playable.has(card);
    return false;
  };

  const opponentName = detail.opponent?.name ?? "an opponent yet to join";

  return (
    <div className="stack">
      {/* The visible heading is the turn banner; screen readers get the match
          itself as the page's level-one heading. */}
      <h1 className="sr-only">
        Cribbage against {opponentName}
        {view.handNumber > 0 ? `, hand ${view.handNumber}` : ""}
      </h1>

      {/* --- turn indicator --- */}
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
          <CribbageBoard
            names={names}
            scores={view.scores}
            prevScores={view.prevScores}
            you={view.you}
            target={view.target}
            winnerSeat={view.winnerSeat}
          />

          {/* --- the table --- */}
          <section className="table stack" aria-label="Table">
            <div className="table-row">
              <div className="stack-sm">
                <span className="table-label">Starter</span>
                {view.starter ? (
                  <PlayingCard card={view.starter} starter />
                ) : (
                  <div className="pcard-slot" />
                )}
              </div>

              <div className="stack-sm" style={{ flex: 1, minWidth: 200 }}>
                <span className="table-label">
                  {view.phase === "pegging" || view.play.history.length > 0
                    ? "The play"
                    : " "}
                </span>
                <PlayArea view={view} names={names} />
              </div>

              {view.phase === "pegging" && (
                <div className="count-chip">
                  <span className="count-chip-value">{view.play.total}</span>
                  <span className="count-chip-label">count</span>
                </div>
              )}
            </div>

            <div className="table-row" style={{ gap: 26 }}>
              <div className="stack-sm">
                <span className="table-label">
                  {view.youAreDealer ? "Your crib" : `${names[view.dealer]}'s crib`}
                </span>
                <div className="card-strip card-strip--tight">
                  {view.crib
                    ? view.crib.map((card) => (
                        <PlayingCard key={card} card={card} small />
                      ))
                    : Array.from({ length: view.cribSize }, (_, i) => (
                        <CardBack key={i} small />
                      ))}
                  {view.cribSize === 0 && !view.crib && (
                    <span className="small" style={{ opacity: 0.6 }}>
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
                        <PlayingCard key={card} card={card} small />
                      ))
                    : Array.from({ length: view.opponentCardCount }, (_, i) => (
                        <CardBack key={i} small />
                      ))}
                  {view.opponentCardCount === 0 && !view.opponentHand && (
                    <span className="small" style={{ opacity: 0.6 }}>
                      no cards
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* --- your hand --- */}
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
              {handCards.map((card) => {
                const isSelected = selected.includes(card);
                const enabled = selectable(card);
                return (
                  <button
                    key={card}
                    type="button"
                    className="pcard-button"
                    data-selected={isSelected}
                    disabled={!enabled}
                    aria-pressed={isSelected}
                    aria-label={`${cardName(card)}${
                      isPegging && !enabled ? " — would go past 31" : ""
                    }`}
                    onClick={() => toggle(card)}
                  >
                    <PlayingCard card={card} />
                  </button>
                );
              })}
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

        {/* --- side panel --- */}
        <aside className="game-side">
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">History</span>
            </div>
            <HistoryLog log={detail.log} />
          </div>
        </aside>
      </div>
    </div>
  );
}

// --- sub-components --------------------------------------------------------

function PlayArea({
  view,
  names,
}: {
  view: GameDetail["view"];
  names: [string, string];
}) {
  const shown = view.play.sequence.length > 0 ? view.play.sequence : view.play.history;
  if (shown.length === 0) {
    return (
      <p className="small" style={{ opacity: 0.62 }}>
        {view.phase === "discard"
          ? "Cards go down once both players have discarded."
          : "No cards played yet."}
      </p>
    );
  }
  return (
    <div className="card-strip card-strip--tight">
      {shown.map((played, index) => (
        <div key={`${played.card}-${index}`} className="stack-sm" style={{ gap: 4 }}>
          <PlayingCard card={played.card} small />
          <span
            className="tiny num"
            style={{ textAlign: "center", opacity: 0.7 }}
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
        {selected.length === 1 ? `Play ${cardLabel(selected[0]!)}` : "Select a card to play"}
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
