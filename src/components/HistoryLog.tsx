"use client";

import type { ReactNode } from "react";
import type { LogEntry } from "@/lib/api-types";
import { MiniCard } from "./PlayingCard";

const CARD_IN_TEXT = /(10|[AJQK2-9])([\u2660\u2665\u2666\u2663])/g;
const RED_SUITS = new Set(["\u2665", "\u2666"]);

/**
 * Renders a log line with any card it names set as a chip rather than left as
 * bare text, so the log reads the same way the scoring breakdowns do.
 */
function withCardChips(message: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of message.matchAll(CARD_IN_TEXT)) {
    const at = match.index;
    if (at > cursor) parts.push(message.slice(cursor, at));
    const [label, , suit] = match;
    parts.push(
      <span
        key={key++}
        className={`mini-card${RED_SUITS.has(suit!) ? " mini-card--red" : ""}`}
      >
        {label}
      </span>,
    );
    cursor = at + label.length;
  }

  if (cursor < message.length) parts.push(message.slice(cursor));
  return parts;
}

/**
 * Reverse-chronological action log, grouped by hand. Entries newer than
 * `freshAfter` slide in, so an opponent's move is visible without hunting for
 * it — the caller owns that watermark, since it is the one that knows when an
 * update arrived. Show and pegging entries carry their scoring breakdown
 * behind a disclosure, so "where did those eight points come from?" is always
 * answerable without leaving the board.
 */
export function HistoryLog({
  log,
  freshAfter = null,
}: {
  log: LogEntry[];
  /** Entries with a higher seq than this animate in. */
  freshAfter?: number | null;
}) {
  if (log.length === 0) {
    return <p className="empty small">Nothing has happened yet.</p>;
  }

  const newestFirst = [...log].sort((a, b) => b.seq - a.seq);
  const rows: React.ReactNode[] = [];
  let lastHand: number | null = null;

  for (const entry of newestFirst) {
    if (entry.handNumber !== lastHand) {
      lastHand = entry.handNumber;
      rows.push(
        <div key={`hand-${entry.seq}`} className="log-hand">
          {entry.handNumber === 0 ? "Setup" : `Hand ${entry.handNumber}`}
        </div>,
      );
    }

    const breakdown = entry.detail?.breakdown ?? [];
    const isFresh = freshAfter !== null && entry.seq > freshAfter;

    rows.push(
      <div key={entry.seq} className={`log-item${isFresh ? " log-item--fresh" : ""}`}>
        <span
          className={`log-seat${
            entry.seat === null
              ? ""
              : entry.seat === 0
                ? " log-seat--p0"
                : " log-seat--p1"
          }`}
          aria-hidden="true"
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="log-message">{withCardChips(entry.message)}</span>
          {breakdown.length > 0 && (
            <details className="disclosure">
              <summary>How that was scored</summary>
              <ul className="breakdown">
                {breakdown.map((item, index) => (
                  <li key={index}>
                    <span className="breakdown-points">{item.points}</span>
                    <span>{item.label}</span>
                    {item.cards && item.cards.length > 0 && (
                      <span className="breakdown-cards">
                        {item.cards.map((card) => (
                          <MiniCard key={card} card={card} />
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        {entry.points ? <span className="log-points">+{entry.points}</span> : null}
      </div>,
    );
  }

  return <div className="log">{rows}</div>;
}
