import type { Seat } from "@/lib/cribbage";

/**
 * A cribbage board rendered as two 121-hole tracks.
 *
 * Each player gets a front peg (current score) and a back peg (score before
 * the last award) — the same information a real board carries, which is what
 * makes "how much did they just take?" readable at a glance. The SVG scales
 * with its container, so the holes become texture on a phone while the pegs
 * stay legible.
 */

const HOLES = 121;
const HOLE_GAP = 4.4;
const GROUP_GAP = 1.6;
const START_X = 14;
const LEFT = 26;
const LANE_Y: [number, number] = [30, 66];
const SKUNK_HOLE = 91;

function holeX(index: number): number {
  return LEFT + index * HOLE_GAP + Math.floor(index / 5) * GROUP_GAP;
}

const WIDTH = holeX(HOLES - 1) + 22;

/** Peg position for a score: hole 1 is the first peg-in, 0 sits on the start post. */
function pegX(score: number): number {
  if (score <= 0) return START_X;
  return holeX(Math.min(score, HOLES) - 1);
}

interface CribbageBoardProps {
  names: [string, string];
  scores: [number, number];
  prevScores: [number, number];
  you: Seat;
  target: number;
  winnerSeat: Seat | null;
}

export function CribbageBoard({
  names,
  scores,
  prevScores,
  you,
  target,
  winnerSeat,
}: CribbageBoardProps) {
  const seats: Seat[] = [0, 1];
  const colorOf = (seat: Seat) => (seat === 0 ? "var(--p0)" : "var(--p1)");

  return (
    <div className="stack-sm">
      <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
        {seats.map((seat) => (
          <div key={seat} className="score-row" style={{ minWidth: 0 }}>
            <span className="peg-dot" style={{ background: colorOf(seat) }} />
            <span className="score-name">
              {names[seat]}
              {seat === you ? " (you)" : ""}
            </span>
            <span className="score-value num" style={{ color: colorOf(seat) }}>
              {scores[seat]}
            </span>
            <span className="tiny muted">
              {winnerSeat === seat
                ? "won"
                : `${Math.max(target - scores[seat], 0)} to go`}
            </span>
          </div>
        ))}
      </div>

      <div className="board">
        <svg
          viewBox={`0 0 ${WIDTH} 96`}
          role="img"
          aria-label={`Board: ${names[0]} ${scores[0]}, ${names[1]} ${scores[1]}, playing to ${target}.`}
        >
          <defs>
            <linearGradient id="groove" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(0 0 0 / 0.28)" />
              <stop offset="100%" stopColor="rgb(255 255 255 / 0.06)" />
            </linearGradient>
          </defs>

          {seats.map((seat) => {
            const y = LANE_Y[seat];
            return (
              <g key={seat}>
                {/* Lane groove */}
                <rect
                  x={START_X - 8}
                  y={y - 11}
                  width={WIDTH - START_X - 6}
                  height={22}
                  rx={11}
                  fill="url(#groove)"
                />
                {/* Start post */}
                <circle cx={START_X} cy={y} r={2.6} fill="rgb(0 0 0 / 0.45)" />

                {/* The 121 holes, grouped in fives. */}
                {Array.from({ length: HOLES }, (_, i) => (
                  <circle
                    key={i}
                    cx={holeX(i)}
                    cy={y}
                    r={1.35}
                    fill={
                      (i + 1) % 5 === 0 ? "rgb(0 0 0 / 0.55)" : "rgb(0 0 0 / 0.32)"
                    }
                  />
                ))}

                {/* Back peg: where the score stood before the last award. */}
                {prevScores[seat] !== scores[seat] && (
                  <circle
                    cx={pegX(prevScores[seat])}
                    cy={y}
                    r={2.9}
                    fill="none"
                    stroke={colorOf(seat)}
                    strokeWidth={1.6}
                    opacity={0.75}
                  />
                )}

                {/* Front peg: the current score. */}
                <g>
                  <circle
                    cx={pegX(scores[seat])}
                    cy={y}
                    r={4.4}
                    fill={colorOf(seat)}
                    stroke="rgb(0 0 0 / 0.35)"
                    strokeWidth={0.8}
                  />
                  <circle
                    cx={pegX(scores[seat]) - 1.1}
                    cy={y - 1.1}
                    r={1.3}
                    fill="rgb(255 255 255 / 0.5)"
                  />
                </g>
              </g>
            );
          })}

          {/* Skunk line at 91 — under it at game end and you are skunked. */}
          <line
            x1={holeX(SKUNK_HOLE - 1)}
            y1={12}
            x2={holeX(SKUNK_HOLE - 1)}
            y2={84}
            stroke="rgb(0 0 0 / 0.3)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />

          {[1, 30, 60, 91, 121].map((mark) => (
            <text
              key={mark}
              x={holeX(mark - 1)}
              y={92}
              textAnchor="middle"
              fontSize="7"
              fill="rgb(255 255 255 / 0.55)"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {mark === 91 ? "91 skunk" : mark}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
