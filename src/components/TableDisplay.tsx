"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TableView } from "@/lib/api-types";
import { reactionFor } from "@/lib/cribbage";
import { CribbageBoard } from "./CribbageBoard";
import { CardBack, PlayingCard } from "./PlayingCard";
import { QrCode } from "./QrCode";

/** A television is not being polled by someone who might act, so keep it brisk. */
const POLL_MS = 3000;
const TALK_MS = 6000;

export function TableDisplay({ initial }: { initial: TableView }) {
  const [table, setTable] = useState(initial);
  const tableRef = useRef(initial);
  const inFlight = useRef(false);
  const seenTalk = useRef(new Set(initial.reactions.map((entry) => entry.id)));
  const [talk, setTalk] = useState<{ id: string; text: string; track: number } | null>(
    null,
  );

  useEffect(() => {
    tableRef.current = table;
  }, [table]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(`/api/tv/${initial.code}`, { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as TableView;

      // Anything said across the board gets its moment on the big screen.
      for (const entry of next.reactions) {
        if (seenTalk.current.has(entry.id)) continue;
        seenTalk.current.add(entry.id);
        const reaction = reactionFor(entry.key);
        const who = next.view.players[entry.seat];
        if (reaction && who) {
          setTalk({
            id: entry.id,
            text: `${who.name}: ${reaction.text}`,
            track: who.track,
          });
          window.setTimeout(
            () => setTalk((current) => (current?.id === entry.id ? null : current)),
            TALK_MS,
          );
        }
      }
      setTable(next);
    } catch {
      /* the next tick will retry */
    } finally {
      inFlight.current = false;
    }
  }, [initial.code]);

  useEffect(() => {
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const { view } = table;
  const tracks = view.tracks.map((track) => ({
    name: track.names.filter(Boolean).join(" & ") || `Side ${track.track + 1}`,
    score: track.score,
    prevScore: track.prevScore,
    yours: false,
    won: view.winnerTrack === track.track,
  }));

  // Before the table fills, the screen's whole job is to get people into it.
  if (view.phase === "awaiting_opponent") {
    return (
      <div className="tv tv--lobby">
        <h1 className="tv-title">Cribbage</h1>
        <p className="tv-headline">{view.headline}</p>
        <div className="tv-join">
          <div className="tv-join-code">
            <span className="tv-join-label">Room code</span>
            <span className="tv-code">{table.code}</span>
            <span className="tv-join-hint">{hostOf(table.joinUrl)}</span>
          </div>
          <div className="tv-qr">
            <QrCode value={table.joinUrl} size={260} title="Scan to take a seat" />
            <span className="tv-join-hint">Point a phone at this</span>
          </div>
        </div>
        <ul className="tv-seats">
          {view.players.map((player) => (
            <li key={player.seat} className={player.name ? "taken" : ""}>
              <span className="peg-dot" style={{ background: `var(--p${player.track})` }} />
              {player.name || "Open seat"}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="tv">
      <header className="tv-head">
        <span className="tv-hand">Hand {view.handNumber}</span>
        <p className="tv-headline">{view.headline}</p>
        <span className="tv-room">
          {table.code}
          {table.seatsOpen > 0 && ` · ${table.seatsOpen} seat${table.seatsOpen > 1 ? "s" : ""} open`}
        </span>
      </header>

      <div className="tv-board">
        <CribbageBoard tracks={tracks} target={view.target} bumped={null} />
      </div>

      <div className="tv-table">
        <div className="tv-slot">
          <span className="tv-label">Starter</span>
          {view.starter ? (
            <PlayingCard card={view.starter} />
          ) : (
            <span className="tv-empty">not cut</span>
          )}
        </div>

        <div className="tv-slot tv-slot--wide">
          <span className="tv-label">
            The play{view.phase === "pegging" ? ` — ${view.play.total}` : ""}
          </span>
          <div className="tv-play">
            {view.play.sequence.length === 0 ? (
              <span className="tv-empty">no cards down</span>
            ) : (
              view.play.sequence.map((played) => (
                <span key={`${played.card}-${played.total}`} className="tv-played">
                  <PlayingCard card={played.card} />
                  <span
                    className="tv-played-peg"
                    style={{
                      background: `var(--p${view.players[played.seat]?.track ?? 0})`,
                    }}
                  />
                </span>
              ))
            )}
          </div>
        </div>

        <div className="tv-slot">
          <span className="tv-label">
            {view.players[view.dealer]?.name ?? "Dealer"}&rsquo;s crib
          </span>
          <div className="tv-pile">
            {view.crib
              ? view.crib.map((card) => <PlayingCard key={card} card={card} size="sm" />)
              : Array.from({ length: view.cribSize }, (_, index) => (
                  <CardBack key={index} size="sm" />
                ))}
            {view.cribSize === 0 && !view.crib && <span className="tv-empty">empty</span>}
          </div>
        </div>
      </div>

      <ul className="tv-players">
        {view.players.map((player) => (
          <li
            key={player.seat}
            className={`tv-player${player.isTurn ? " tv-player--turn" : ""}`}
          >
            <span className="peg-dot" style={{ background: `var(--p${player.track})` }} />
            <span className="tv-player-name">{player.name}</span>
            {player.seat === view.dealer && <span className="tv-chip">deals</span>}
            {player.saidGo && <span className="tv-chip">go</span>}
            <span className="tv-cards" aria-label={`${player.cardCount} cards`}>
              {player.hand
                ? player.hand.map((card) => (
                    <PlayingCard key={card} card={card} size="sm" />
                  ))
                : Array.from({ length: player.cardCount }, (_, index) => (
                    <CardBack key={index} size="sm" />
                  ))}
            </span>
          </li>
        ))}
      </ul>

      {talk && (
        <div className="tv-talk" style={{ borderColor: `var(--p${talk.track})` }}>
          {talk.text}
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
