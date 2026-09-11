"use client";

import { useLayoutEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./motion";

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

/** Vertical pitch between one peg's pair of rows and the next. */
const LANE_PITCH = 78;
const LANE_TOP = 40;

/**
 * One lane per scoring track. Heads-up and partnership games draw two; the
 * three-handed game draws three, and the board grows a street taller for it.
 */
function lanesFor(tracks: number): { out: number; back: number }[] {
  return Array.from({ length: tracks }, (_, index) => {
    const out = LANE_TOP + index * LANE_PITCH;
    return { out, back: out + TURN_R * 2 };
  });
}

const VB_W = Math.round(X_END + TURN_R + 20);

function boardHeight(tracks: number): number {
  return LANE_TOP + (tracks - 1) * LANE_PITCH + 66;
}
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

const PEG_TRAVEL_MS = 900;

/**
 * A peg travelling its lane.
 *
 * The movement is driven explicitly through the Web Animations API rather than
 * left to a CSS transition on `offset-distance`: that transition is patchily
 * supported (Safari in particular), and this is the one animation in the app
 * that carries information — how far the score just moved. Animating it by
 * hand means it either runs or it does not, and it can be verified.
 *
 * The peg group rides the motion path; the body inside lifts out of its hole
 * and drops into the new one on the way.
 */
function Peg({
  path,
  distance,
  color,
  highlight,
}: {
  path: string;
  distance: number;
  color: string;
  highlight: string;
}) {
  const group = useRef<SVGGElement>(null);
  const body = useRef<SVGGElement>(null);
  const previous = useRef(distance);
  const reduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = distance;
    if (from === distance || reduced) return;

    group.current?.animate(
      [{ offsetDistance: `${from}px` }, { offsetDistance: `${distance}px` }],
      { duration: PEG_TRAVEL_MS, easing: "cubic-bezier(0.34, 0.8, 0.3, 1)" },
    );

    body.current?.animate(
      [
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-7px) scale(1.18)", offset: 0.22 },
        { transform: "translateY(-7px) scale(1.18)", offset: 0.72 },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: PEG_TRAVEL_MS, easing: "ease-in-out" },
    );
  }, [distance, reduced]);

  return (
    <g
      ref={group}
      className="peg peg--front"
      style={{ offsetPath: `path("${path}")`, offsetDistance: `${distance}px` }}
    >
      <g ref={body} className="peg-body">
        <ellipse cx="0.8" cy="2.4" rx="5" ry="2.2" fill="rgb(0 0 0 / 0.35)" />
        <circle r="5" fill={color} stroke="rgb(0 0 0 / 0.4)" strokeWidth="0.9" />
        <circle cx="-1.4" cy="-1.6" r="1.8" fill={highlight} />
        <circle cx="-1.9" cy="-2.1" r="0.8" fill="rgb(255 255 255 / 0.75)" />
      </g>
    </g>
  );
}

/** One peg's worth of the board: a side, not necessarily a person. */
export interface BoardTrack {
  /** Whose peg this is: a player, or a partnership. */
  name: string;
  score: number;
  prevScore: number;
  /** True for the viewer's own side. */
  yours: boolean;
  won: boolean;
}

interface CribbageBoardProps {
  tracks: BoardTrack[];
  target: number;
  /** Track whose score just changed, for the score-number pop. */
  bumped?: number | null;
}

export function pegColor(track: number): string {
  return `var(--p${track})`;
}

export function pegHighlight(track: number): string {
  return `var(--p${track}-light)`;
}

export function CribbageBoard({ tracks, target, bumped }: CribbageBoardProps) {
  const LANES = lanesFor(tracks.length);
  const VB_H = boardHeight(tracks.length);
  const seats = tracks.map((_, index) => index);
  const scores = tracks.map((track) => track.score);
  const prevScores = tracks.map((track) => track.prevScore);
  const names = tracks.map((track) => track.name);

  return (
    <div className="stack-sm">
      <div className="scoreboard">
        {seats.map((seat) => (
          <div key={seat} className="score-row">
            <span className="peg-dot" style={{ background: pegColor(seat) }} />
            <span className="score-name">
              {names[seat]}
              {tracks[seat]!.yours ? " (you)" : ""}
            </span>
            <span
              className={`score-value${bumped === seat ? " score-value--bump" : ""}`}
              style={{ color: pegColor(seat) }}
            >
              {scores[seat]}
            </span>
            <span className="tiny muted">
              {tracks[seat]!.won
                ? "won"
                : `${Math.max(target - scores[seat]!, 0)} to go`}
            </span>
          </div>
        ))}
      </div>

      <div className="board-frame">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          aria-label={`Board: ${tracks
            .map((track) => `${track.name} on ${track.score}`)
            .join(", ")}, playing to ${target}.`}
        >
          <defs>
            <radialGradient id="screwHead" cx="0.34" cy="0.3" r="0.85">
              <stop offset="0%" stopColor="#f0d69b" />
              <stop offset="55%" stopColor="#c08b3e" />
              <stop offset="100%" stopColor="#6d4520" />
            </radialGradient>
          </defs>

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

          {/* Centre inlay, broken around an engraved wordmark. */}
          {(() => {
            // The inlay runs in the channel between two lanes, so it has to
            // land in a gap rather than at the board's arithmetic centre —
            // with three pegs that centre falls straight through the middle
            // lane's holes. Of the gaps available, take the one nearest the
            // middle.
            const middle = (LANES[0]!.out + LANES[LANES.length - 1]!.back) / 2;
            const gaps = LANES.slice(0, -1).map(
              (lane, index) => (lane.back + LANES[index + 1]!.out) / 2,
            );
            const y = gaps.reduce((best, candidate) =>
              Math.abs(candidate - middle) < Math.abs(best - middle) ? candidate : best,
            );
            const gap = 54;
            const mid = VB_W / 2;
            return (
              <g>
                <line
                  x1="22"
                  y1={y}
                  x2={mid - gap}
                  y2={y}
                  stroke="rgb(255 255 255 / 0.1)"
                  strokeWidth="1"
                />
                <line
                  x1={mid + gap}
                  y1={y}
                  x2={VB_W - 22}
                  y2={y}
                  stroke="rgb(255 255 255 / 0.1)"
                  strokeWidth="1"
                />
                <text
                  x={mid}
                  y={y + 2.6}
                  textAnchor="middle"
                  fontSize="7.5"
                  letterSpacing="2.6"
                  fill="rgb(255 255 255 / 0.22)"
                  fontFamily="var(--font-ui)"
                >
                  CRIBBAGE
                </text>
              </g>
            );
          })()}

          {/* Brass screws holding the board down. */}
          {[
            [16, 15],
            [VB_W - 16, 15],
            [16, VB_H - 15],
            [VB_W - 16, VB_H - 15],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="4.2" fill="rgb(0 0 0 / 0.3)" />
              <circle cx={x} cy={y} r="3.6" fill="url(#screwHead)" />
              <line
                x1={x! - 2.1}
                y1={y! - 1}
                x2={x! + 2.1}
                y2={y! + 1}
                stroke="rgb(0 0 0 / 0.5)"
                strokeWidth="0.9"
                strokeLinecap="round"
              />
            </g>
          ))}

          {seats.map((seat) => {
            const lane = LANES[seat]!;
            const path = trackPath(lane);
            const [skunkX, skunkY] = holePoint(SKUNK, lane);
            const [gameHoleX, gameHoleY] = holePoint(GAME_HOLE, lane);

            return (
              <g key={seat}>
                {/* A routed channel: the lower lip catches the light, the
                    channel itself is in shadow, and a soft sheen sits along
                    the bottom of the cut. */}
                <path
                  d={path}
                  transform="translate(0 1.4)"
                  fill="none"
                  stroke="rgb(255 235 200 / 0.16)"
                  strokeWidth="15"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
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
                  transform="translate(0 -0.9)"
                  fill="none"
                  stroke="rgb(0 0 0 / 0.22)"
                  strokeWidth="13"
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
                      {/* Countersunk rim, the bore, then the lit far wall. */}
                      <circle
                        cx={x}
                        cy={y + 0.5}
                        r={isGame ? 3.4 : isFifth ? 2.7 : 2.3}
                        fill="rgb(255 235 205 / 0.09)"
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={isGame ? 2.8 : isFifth ? 2.1 : 1.75}
                        fill="rgb(0 0 0 / 0.6)"
                      />
                      <circle
                        cx={x}
                        cy={y + 0.55}
                        r={isGame ? 2.2 : isFifth ? 1.6 : 1.3}
                        fill="rgb(120 80 40 / 0.35)"
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
                      offsetDistance: `${distanceFor(prevScores[seat]!)}px`,
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

                {/* Front peg: the current score. */}
                <Peg
                  path={path}
                  distance={distanceFor(scores[seat]!)}
                  color={pegColor(seat)}
                  highlight={pegHighlight(seat)}
                />
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
            y={LANES[LANES.length - 1]!.back + 17}
            textAnchor="middle"
            fontSize="8"
            fontWeight="700"
            fill="var(--brass-light)"
            fontFamily="var(--font-ui)"
          >
            121
          </text>
          <text
            x={holePoint(SKUNK, LANES[LANES.length - 1]!)[0]}
            y={LANES[LANES.length - 1]!.back + 17}
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
