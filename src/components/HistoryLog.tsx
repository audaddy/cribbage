"use client";

import type { LogEntry, ReactionEntry } from "@/lib/api-types";
import { reactionFor } from "@/lib/cribbage";
import { MiniCard, withCardChips } from "./PlayingCard";

export function HistoryLog({
  log,
  reactions = [],
  names = [],
  tracks = [],
  freshAfter = null,
}: {
  log: LogEntry[];
  /** Table talk, folded into the same timeline as the moves. */
  reactions?: ReactionEntry[];
  names?: string[];
  /** Scoring track per seat, for the colour stripe. */
  tracks?: number[];
  /** Entries with a higher seq than this animate in. */
  freshAfter?: number | null;
}) {
  // A toast lasts a few seconds; a game lasts days. Anything said across the
  // board belongs in the record too, or whoever was not looking at their phone
  // at that moment never learns it happened.
  const talk: LogEntry[] = reactions.flatMap((entry) => {
    const reaction = reactionFor(entry.key);
    if (!reaction) return []; // a line since retired from the catalogue
    return [
      {
        // Sorted alongside moves by time, then pinned after the move it follows.
        seq: seqForTalk(entry, log),
        seat: entry.seat,
        type: "talk",
        message: `${names[entry.seat] ?? "Someone"}: ${reaction.text}`,
        points: null,
        handNumber: handForTalk(entry, log),
        detail: null,
        createdAt: entry.createdAt,
      },
    ];
  });

  const merged = [...log, ...talk];
  if (merged.length === 0) {
    return <p className="empty small">Nothing has happened yet.</p>;
  }

  const newestFirst = [...merged].sort((a, b) =>
    a.createdAt === b.createdAt ? b.seq - a.seq : (a.createdAt < b.createdAt ? 1 : -1),
  );
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
      <div
        key={`${entry.type}-${entry.seq}-${entry.createdAt}`}
        className={`log-item${isFresh ? " log-item--fresh" : ""}${
          entry.type === "talk" ? " log-item--talk" : ""
        }`}
      >
        <span
          className={`log-seat${
            entry.seat === null ? "" : ` log-seat--p${tracks[entry.seat] ?? entry.seat}`
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

/**
 * Where a line of talk sits in the log.
 *
 * Reactions carry a timestamp but no sequence number, because they are not
 * moves. Borrowing the seq of the last move before them keeps the hand grouping
 * right; the fractional bump keeps the line after that move rather than tied
 * with it.
 */
function seqForTalk(entry: ReactionEntry, log: LogEntry[]): number {
  const preceding = log.filter((item) => item.createdAt <= entry.createdAt).at(-1);
  return (preceding?.seq ?? -1) + 0.5;
}

function handForTalk(entry: ReactionEntry, log: LogEntry[]): number {
  const preceding = log.filter((item) => item.createdAt <= entry.createdAt).at(-1);
  return preceding?.handNumber ?? log.at(-1)?.handNumber ?? 0;
}
