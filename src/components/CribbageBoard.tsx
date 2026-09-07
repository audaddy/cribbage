import type { Seat } from "@/lib/cribbage";

/**
 * A cribbage board drawn as two serpentine tracks.
 *
 * Each player's lane runs out along the top row (holes 1–60), turns at the far
 * end, comes back along the bottom (61–120), and finishes in the game hole.
 * The same geometry produces both the SVG path and every hole position, so the
 * pegs sit exactly in their holes.
 *
 * Pegs move with `offset-path`, which walks them along the real track — around
 * the turn included — rather than sliding across the board in a straight line.
 * Each player carries a front peg at the current score and a back peg at the
 * previous one, the way a real board records the size of the last award.
 */

const HOLES_PER_ROW = 60;
const SPACING = 8.4;
const GROUP_GAP = 3.2; // extra breathing room after every fifth hole
const X_START = 46;

/** Distance from the first hole of a row to hole `index` (0-based). */
function rowOffset(index: number): number {
  return index * SPACING + Math.floor(index / 5) * GROUP_GAP;
}

const SPAN = rowOffset(HOLES_PER_ROW - 1);
const X_END = X_START + SPAN;
const TURN_R = 16;
const PEG_START_X = X_START - 20;
const GAME_X = PEG_START_X;

const LANES: { out: number; back: number }[] = [
  { out: 40, back: 40 + TURN_R * 2 },
  { out: 118, back: 118 + TURN_R * 2 },
];

const VB_W = Math.round(X_END + TURN_R + 20);
const VB_H = 184;
const SKUNK = 91;
const GAME_HOLE = 121;

function trackPath(lane: { out: number; back: number }): string {
  return [
    `M ${PEG_START_X} ${lane.out}`,
    `L ${X_END} ${lane.out}`,
    `A ${TURN_R} ${TURN_R} 0 0 1 ${X_END} ${lane.back}`,
    `L ${X_START} ${lane.back}`,
    `L ${GAME_X} ${lane.back}`,
  ].join(" ");
}

const OUT_LEN = X_END - PEG_START_X;
const TURN_LEN = Math.PI * TURN_R;
const BACK_LEN = X_END - X_START;
const TAIL_LEN = X_START - GAME_X;

/** How far along the track a peg sits for a given score, in user units. */
function distanceFor(score: number): number {
  if (score <= 0) return 0;
  if (score <= HOLES_PER_ROW) {
    return X_START - PEG_START_X + rowOffset(score - 1);
  }
  if (score < GAME_HOLE) {
    return OUT_LEN + TURN_LEN + rowOffset(score - HOLES_PER_ROW - 1);
  }
  return OUT_LEN + TURN_LEN + BACK_LEN + TAIL_LEN;
}

/** Where hole `score` is drawn. */
function holePoint(
  score: number,
  lane: { out: number; back: number },
): [number, number] {
  if (score <= HOLES_PER_ROW) return [X_START + rowOffset(score - 1), lane.out];
  if (score < GAME_HOLE) {
    return [X_END - rowOffset(score - HOLES_PER_ROW - 1), lane.back];
  }
  return [GAME_X, lane.back];
}

interface CribbageBoardProps {
  names: [string, string];
  scores: [number, number];
  prevScores: [number, number];
  you: Seat;
  target: number;
  winnerSeat: Seat | null;
  /** Seat whose score just changed, for the pop animation. */
  bumped?: Seat | null;
}

export function CribbageBoard({
  names,
  scores,
  prevScores,
  you,
  target,
  winnerSeat,
  bumped,
}: CribbageBoardProps) {
  const seats: Seat[] = [0, 1];
  const pegColor = (seat: Seat) => (seat === 0 ? "var(--p0)" : "var(--p1)");
  const pegHighlight = (seat: Seat) =>
    seat === 0 ? "var(--p0-light)" : "var(--p1-light)";

  return (
    <div className="stack-sm">
      <div className="scoreboard">
        {seats.map((seat) => (
          <div key={seat} className="score-row">
            <span className="peg-dot" style={{ background: pegColor(seat) }} />
            <span className="score-name">
              {names[seat]}
              {seat === you ? " (you)" : ""}
            </span>
            <span
              className={`score-value${bumped === seat ? " score-value--bump" : ""}`}
              style={{ color: pegColor(seat) }}
            >
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

      <div className="board-frame">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          aria-label={`Board: ${names[0]} on ${scores[0]}, ${names[1]} on ${scores[1]}, playing to ${target}.`}
        >
          {/* Recessed playing surface. */}
          <rect
            x="5"
            y="5"
            width={VB_W - 10}
            height={VB_H - 10}
            rx="11"
            fill="rgb(0 0 0 / 0.16)"
            stroke="rgb(0 0 0 / 0.3)"
            strokeWidth="1"
          />
          <rect
            x="8"
            y="8"
            width={VB_W - 16}
            height={VB_H - 16}
            rx="9"
            fill="none"
            stroke="rgb(255 255 255 / 0.13)"
            strokeWidth="1"
          />

          {/* Centre inlay between the two players' blocks. */}
          <line
            x1="20"
            y1={(LANES[0]!.back + LANES[1]!.out) / 2}
            x2={VB_W - 20}
            y2={(LANES[0]!.back + LANES[1]!.out) / 2}
            stroke="rgb(255 255 255 / 0.1)"
            strokeWidth="1"
          />

          {seats.map((seat) => {
            const lane = LANES[seat]!;
            const path = trackPath(lane);
            const [skunkX, skunkY] = holePoint(SKUNK, lane);
            const [gameHoleX, gameHoleY] = holePoint(GAME_HOLE, lane);

            return (
              <g key={seat}>
                {/* The carved groove the pegs travel down. */}
                <path
                  d={path}
                  fill="none"
                  stroke="rgb(0 0 0 / 0.3)"
                  strokeWidth="15"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={path}
                  fill="none"
                  stroke="rgb(255 255 255 / 0.08)"
                  strokeWidth="12.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Lane tint, so the two players' tracks read apart. */}
                <path
                  d={path}
                  fill="none"
                  stroke={pegColor(seat)}
                  strokeOpacity="0.16"
                  strokeWidth="12.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* The 120 holes plus the game hole. */}
                {Array.from({ length: GAME_HOLE }, (_, i) => {
                  const score = i + 1;
                  const [x, y] = holePoint(score, lane);
                  const isFifth = score % 5 === 0;
                  const isGame = score === GAME_HOLE;
                  return (
                    <g key={score}>
                      <circle
                        cx={x}
                        cy={y}
                        r={isGame ? 2.8 : isFifth ? 2.1 : 1.7}
                        fill="rgb(0 0 0 / 0.52)"
                      />
                      <circle
                        cx={x}
                        cy={y + 0.7}
                        r={isGame ? 2.4 : isFifth ? 1.7 : 1.35}
                        fill="rgb(255 255 255 / 0.07)"
                      />
                    </g>
                  );
                })}

                {/* Start post. */}
                <circle
                  cx={PEG_START_X}
                  cy={lane.out}
                  r="2.8"
                  fill="rgb(0 0 0 / 0.55)"
                />
                <circle
                  cx={PEG_START_X}
                  cy={lane.out}
                  r="5"
                  fill="none"
                  stroke="rgb(255 255 255 / 0.18)"
                  strokeWidth="0.9"
                />

                {/* Game hole, ringed in brass. */}
                <circle
                  cx={gameHoleX}
                  cy={gameHoleY}
                  r="5.2"
                  fill="none"
                  stroke="var(--brass)"
                  strokeOpacity="0.75"
                  strokeWidth="1.2"
                />

                {/* Skunk line at 91. */}
                <line
                  x1={skunkX}
                  y1={skunkY - 9}
                  x2={skunkX}
                  y2={skunkY + 9}
                  stroke="rgb(255 255 255 / 0.34)"
                  strokeWidth="1"
                  strokeDasharray="2.5 2.5"
                />

                {/* Back peg: where this player stood before the last award. */}
                {prevScores[seat] !== scores[seat] && (
                  <g
                    className="peg peg--back"
                    style={{
                      offsetPath: `path("${path}")`,
                      offsetDistance: `${distanceFor(prevScores[seat])}px`,
                    }}
                  >
                    <circle
                      r="3.4"
                      fill="none"
                      stroke={pegColor(seat)}
                      strokeOpacity="0.8"
                      strokeWidth="1.6"
                    />
                  </g>
                )}

                {/* Front peg: the current score. The group rides the motion
                    path; the body inside hops as it goes. */}
                <g
                  className={`peg peg--front${bumped === seat ? " peg--hopping" : ""}`}
                  style={{
                    offsetPath: `path("${path}")`,
                    offsetDistance: `${distanceFor(scores[seat])}px`,
                  }}
                >
                  <g className="peg-body">
                    <ellipse cx="0.8" cy="2.4" rx="5" ry="2.2" fill="rgb(0 0 0 / 0.35)" />
                    <circle
                      r="5"
                      fill={pegColor(seat)}
                      stroke="rgb(0 0 0 / 0.4)"
                      strokeWidth="0.9"
                    />
                    <circle cx="-1.4" cy="-1.6" r="1.8" fill={pegHighlight(seat)} />
                    <circle cx="-1.9" cy="-2.1" r="0.8" fill="rgb(255 255 255 / 0.75)" />
                  </g>
                </g>
              </g>
            );
          })}

          {/* Street markers. */}
          {[10, 20, 30, 40, 50, 60].map((mark) => {
            const [x] = holePoint(mark, LANES[0]!);
            return (
              <text
                key={mark}
                x={x}
                y={LANES[0]!.out - 12}
                textAnchor="middle"
                fontSize="7.5"
                fill="rgb(255 255 255 / 0.42)"
                fontFamily="var(--font-ui)"
              >
                {mark}
              </text>
            );
          })}
          <text
            x={GAME_X}
            y={LANES[1]!.back + 17}
            textAnchor="middle"
            fontSize="8"
            fontWeight="700"
            fill="var(--brass-light)"
            fontFamily="var(--font-ui)"
          >
            121
          </text>
          <text
            x={holePoint(SKUNK, LANES[1]!)[0]}
            y={LANES[1]!.back + 17}
            textAnchor="middle"
            fontSize="7.5"
            fill="rgb(255 255 255 / 0.42)"
            fontFamily="var(--font-ui)"
          >
            skunk
          </text>
        </svg>
      </div>
    </div>
  );
}
