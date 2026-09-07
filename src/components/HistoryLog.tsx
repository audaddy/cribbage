"use client";

import type { LogEntry } from "@/lib/api-types";
import { cardLabel } from "@/lib/cribbage";

/**
 * Reverse-chronological action log, grouped by hand. Show and pegging entries
 * carry their scoring breakdown behind a disclosure, so "where did those eight
 * points come from?" is always answerable without leaving the board.
 */
export function HistoryLog({ log }: { log: LogEntry[] }) {
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
    rows.push(
      <div key={entry.seq} className="log-item">
        <span
          className={`log-seat${
            entry.seat === null ? "" : entry.seat === 0 ? " log-seat--p0" : " log-seat--p1"
          }`}
          aria-hidden="true"
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <span>{entry.message}</span>
          {breakdown.length > 0 && (
            <details className="disclosure">
              <summary>How that was scored</summary>
              <ul className="breakdown">
                {breakdown.map((item, index) => (
                  <li key={index}>
                    <span className="breakdown-points">{item.points}</span>
                    <span>{item.label}</span>
                    {item.cards && item.cards.length > 0 && (
                      <span className="muted">
                        {item.cards.map((card) => cardLabel(card)).join(" ")}
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
