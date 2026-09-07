import type { ReactNode } from "react";
import { type Card, type Suit, rankOf, suitOf } from "@/lib/cribbage";

/**
 * Playing cards drawn as SVG.
 *
 * Faces use the real pip layouts (a seven is six pips plus one raised to the
 * upper centre, a nine is four pairs around a single middle pip), with the
 * lower half rotated as on a printed deck. Vector means they stay crisp from a
 * 30px thumbnail in the crib to a full-size card in hand.
 */

const RED_SUITS = new Set<Suit>(["H", "D"]);

/* Suit shapes, each drawn inside a 100x100 box so they can be placed by a
   single translate/scale. */
const SUIT_SHAPE: Record<Suit, ReactNode> = {
  S: (
    <path d="M50 6c0 0-37 30-37 52 0 13 10 21 21 21 7 0 12-3 15-8-1 10-5 17-13 22h28c-8-5-12-12-13-22 3 5 8 8 15 8 11 0 21-8 21-21C87 36 50 6 50 6Z" />
  ),
  H: (
    <path d="M50 92C18 68 8 52 8 35 8 20 19 11 31 11c9 0 15 5 19 12 4-7 10-12 19-12 12 0 23 9 23 24 0 17-10 33-42 57Z" />
  ),
  D: <path d="M50 4 88 50 50 96 12 50Z" />,
  C: (
    <g>
      <circle cx="50" cy="27" r="19" />
      <circle cx="26" cy="59" r="19" />
      <circle cx="74" cy="59" r="19" />
      <path d="M43 56h14c0 18 4 30 12 37H31c8-7 12-19 12-37Z" />
    </g>
  ),
};

function Pip({
  suit,
  x,
  y,
  size,
  flip = false,
}: {
  suit: Suit;
  x: number;
  y: number;
  size: number;
  flip?: boolean;
}) {
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${flip ? 180 : 0}) scale(${size / 100}) translate(-50 -50)`}
    >
      {SUIT_SHAPE[suit]}
    </g>
  );
}

/* Pip coordinates on the classic three-column grid. Rows are symmetric about
   the middle at y=70, so anything below it is printed upside down. */
const L = 33;
const C = 50;
const R = 67;
const MID = 70;

const PIP_LAYOUTS: Record<number, [number, number][]> = {
  2: [[C, 30], [C, 110]],
  3: [[C, 30], [C, 70], [C, 110]],
  4: [[L, 30], [R, 30], [L, 110], [R, 110]],
  5: [[L, 30], [R, 30], [C, 70], [L, 110], [R, 110]],
  6: [[L, 30], [R, 30], [L, 70], [R, 70], [L, 110], [R, 110]],
  7: [[L, 30], [R, 30], [C, 50], [L, 70], [R, 70], [L, 110], [R, 110]],
  8: [
    [L, 30], [R, 30], [C, 50], [L, 70], [R, 70], [C, 90], [L, 110], [R, 110],
  ],
  9: [
    [L, 30], [R, 30], [L, 57], [R, 57], [C, 70], [L, 83], [R, 83], [L, 110], [R, 110],
  ],
  10: [
    [L, 30], [R, 30], [C, 44], [L, 57], [R, 57],
    [L, 83], [R, 83], [C, 96], [L, 110], [R, 110],
  ],
};

const RANK_TEXT: Record<number, string> = {
  1: "A",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
};

function rankText(rank: number): string {
  return RANK_TEXT[rank] ?? String(rank);
}

const SUIT_WORD: Record<Suit, string> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};

const RANK_WORD: Record<number, string> = {
  1: "ace",
  11: "jack",
  12: "queen",
  13: "king",
};

/** Full accessible name, e.g. "ten of diamonds". */
export function cardName(card: Card): string {
  const rank = rankOf(card);
  return `${RANK_WORD[rank] ?? rank} of ${SUIT_WORD[suitOf(card)]}`;
}

/** Corner index: the rank stacked over a small pip, top-left and mirrored. */
function CornerIndex({ rank, suit }: { rank: number; suit: Suit }) {
  const text = rankText(rank);
  return (
    <g>
      <text
        x="11"
        y="22"
        textAnchor="middle"
        fontSize={text.length > 1 ? 17 : 20}
        fontWeight="700"
        fontFamily="var(--font-ui)"
        letterSpacing="-0.5"
      >
        {text}
      </text>
      <Pip suit={suit} x={11} y={33} size={11} />
    </g>
  );
}

/**
 * Headwear for the court cards, drawn in a 100x100 box.
 *
 * Real court cards carry a mirrored figure. A whole figure turns to mush at
 * the size a card is actually read here, so each rank gets one graphic motif
 * instead — a peaked crown, a pearled coronet, a feathered cap — mirrored top
 * and bottom the way the printed cards are.
 */
const COURT_MOTIF: Record<number, ReactNode> = {
  13: (
    <g>
      <path d="M10 78V30l18 18 22-32 22 32 18-18v48Z" />
      <rect x="10" y="80" width="80" height="13" rx="3" />
      <circle cx="10" cy="25" r="6" />
      <circle cx="50" cy="11" r="7" />
      <circle cx="90" cy="25" r="6" />
    </g>
  ),
  12: (
    <g>
      <path d="M15 79V45c0-15 16-24 35-24s35 9 35 24v34Z" />
      <rect x="12" y="80" width="76" height="12" rx="3" />
      <circle cx="26" cy="30" r="6" />
      <circle cx="50" cy="16" r="7.5" />
      <circle cx="74" cy="30" r="6" />
    </g>
  ),
  // A plume rather than a cap: at the size a card is read, a feather keeps a
  // silhouette where headgear turns into a blob.
  11: (
    <g>
      <path d="M56 4c-22 18-33 45-28 76l6 18 12-20c17-26 21-50 10-74Z" />
      <g stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M42 40 58 27" />
        <path d="M39 56 57 44" />
        <path d="M38 72 54 62" />
      </g>
      <rect x="20" y="84" width="60" height="11" rx="4" />
    </g>
  ),
};

/** Court cards get an engraved panel rather than pips. */
function CourtPanel({ rank, suit }: { rank: number; suit: Suit }) {
  const motif = COURT_MOTIF[rank];
  return (
    <g>
      {/* Double rule, as a printed court card carries. */}
      <rect
        x="20"
        y="26"
        width="60"
        height="88"
        rx="5"
        fill="currentColor"
        fillOpacity="0.06"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.3"
      />
      <rect
        x="23"
        y="29"
        width="54"
        height="82"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.24"
        strokeWidth="0.7"
      />

      <g opacity="0.9">
        <g transform="translate(50 46) scale(0.28) translate(-50 -50)">{motif}</g>
        <g transform="translate(50 94) rotate(180) scale(0.28) translate(-50 -50)">
          {motif}
        </g>
      </g>

      {/* Centre band carrying the rank, flanked by the suit. */}
      <rect
        x="23"
        y="62"
        width="54"
        height="16"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <line x1="23" y1="62" x2="77" y2="62" stroke="currentColor" strokeOpacity="0.3" strokeWidth="0.7" />
      <line x1="23" y1="78" x2="77" y2="78" stroke="currentColor" strokeOpacity="0.3" strokeWidth="0.7" />
      <Pip suit={suit} x={30} y={70} size={10} />
      <Pip suit={suit} x={70} y={70} size={10} />
      <text
        x="50"
        y="70"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="17"
        fontWeight="700"
        fontFamily="var(--font-head)"
        letterSpacing="0.5"
      >
        {rankText(rank)}
      </text>
    </g>
  );
}

/**
 * Paint servers shared by every card. Rendered once at the document root so a
 * table full of cards does not repeat the same gradient ids twenty times.
 */
export function CardDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        <linearGradient id="cardFace" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#fffdf6" />
          <stop offset="100%" stopColor="#f1e9d7" />
        </linearGradient>
        <linearGradient id="cardSheen" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="backField" x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#2f5f92" />
          <stop offset="100%" stopColor="#1b3a5e" />
        </linearGradient>
        <pattern
          id="backLattice"
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path
            d="M0 0h10M0 5h10"
            stroke="rgb(255 255 255 / 0.16)"
            strokeWidth="1.1"
          />
          <path d="M0 0v10M5 0v10" stroke="rgb(255 255 255 / 0.1)" strokeWidth="1" />
        </pattern>
      </defs>
    </svg>
  );
}

export type CardSize = "md" | "sm" | "xs";

const SIZE_CLASS: Record<CardSize, string> = {
  md: "",
  sm: " pcard--sm",
  xs: " pcard--xs",
};

interface PlayingCardProps {
  card: Card;
  size?: CardSize;
  /** Ring the card in brass — used for the starter. */
  starter?: boolean;
  /** Animate as though it were just laid on the table. */
  laid?: boolean;
  /** Stagger index for the deal animation; omit to skip it. */
  dealIndex?: number;
}

export function PlayingCard({
  card,
  size = "md",
  starter,
  laid,
  dealIndex,
}: PlayingCardProps) {
  const rank = rankOf(card);
  const suit = suitOf(card);
  const red = RED_SUITS.has(suit);
  const pips = PIP_LAYOUTS[rank];

  const className = [
    "pcard",
    SIZE_CLASS[size].trim(),
    starter ? "pcard--starter" : "",
    laid ? "pcard--laid" : "",
    dealIndex !== undefined ? "pcard--dealt" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={className}
      style={
        dealIndex !== undefined
          ? ({ "--i": dealIndex } as React.CSSProperties)
          : undefined
      }
    >
    <svg viewBox="0 0 100 140" role="img" aria-label={cardName(card)}>
      <rect x="0" y="0" width="100" height="140" rx="9" fill="url(#cardFace)" />
      <rect x="0" y="0" width="100" height="72" rx="9" fill="url(#cardSheen)" />
      <rect
        x="0.7"
        y="0.7"
        width="98.6"
        height="138.6"
        rx="8.4"
        fill="none"
        stroke="rgb(0 0 0 / 0.22)"
        strokeWidth="1.4"
      />

      <g fill={red ? "#b8281a" : "#17161a"} color={red ? "#b8281a" : "#17161a"}>
        <CornerIndex rank={rank} suit={suit} />
        {/* The index repeats upside down in the opposite corner. */}
        <g transform="rotate(180 50 70)">
          <CornerIndex rank={rank} suit={suit} />
        </g>

        {rank === 1 && <Pip suit={suit} x={50} y={70} size={44} />}
        {rank >= 11 && <CourtPanel rank={rank} suit={suit} />}
        {pips?.map(([x, y], index) => (
          <Pip key={index} suit={suit} x={x} y={y} size={17} flip={y > MID} />
        ))}
      </g>
    </svg>
    </span>
  );
}

/** A face-down card: lattice back, used for the crib and the opponent's hand. */
export function CardBack({ size = "md" }: { size?: CardSize }) {
  return (
    <span className={`pcard pcard--back-stock${SIZE_CLASS[size]}`}>
    <svg viewBox="0 0 100 140" role="img" aria-label="face-down card">
      <rect x="0" y="0" width="100" height="140" rx="9" fill="url(#backField)" />
      <rect x="5" y="5" width="90" height="130" rx="5" fill="url(#backLattice)" />
      <rect
        x="5"
        y="5"
        width="90"
        height="130"
        rx="5"
        fill="none"
        stroke="rgb(255 255 255 / 0.3)"
        strokeWidth="1.4"
      />
      <circle cx="50" cy="70" r="15" fill="rgb(0 0 0 / 0.2)" />
      <g fill="rgb(255 255 255 / 0.35)">
        <Pip suit="S" x={50} y={70} size={18} />
      </g>
      <rect
        x="0.7"
        y="0.7"
        width="98.6"
        height="138.6"
        rx="8.4"
        fill="none"
        stroke="rgb(0 0 0 / 0.3)"
        strokeWidth="1.4"
      />
    </svg>
    </span>
  );
}

/** Compact text chip used inside scoring breakdowns. */
export function MiniCard({ card }: { card: Card }) {
  const suit = suitOf(card);
  const symbol = { S: "♠", H: "♥", D: "♦", C: "♣" }[suit];
  return (
    <span
      className={`mini-card${RED_SUITS.has(suit) ? " mini-card--red" : ""}`}
      // aria-label only names an element that has a role supporting a name.
      role="img"
      aria-label={cardName(card)}
    >
      {rankText(rankOf(card))}
      {symbol}
    </span>
  );
}

const CARD_IN_TEXT = /(10|[AJQK2-9])([\u2660\u2665\u2666\u2663])/g;
const RED_GLYPHS = new Set(["\u2665", "\u2666"]);

/**
 * Renders a line of prose with any card it names set as a chip rather than
 * left as bare text, so log entries and toasts read the way the scoring
 * breakdowns already do.
 */
export function withCardChips(message: string): ReactNode[] {
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
        className={`mini-card${RED_GLYPHS.has(suit!) ? " mini-card--red" : ""}`}
      >
        {label}
      </span>,
    );
    cursor = at + label.length;
  }

  if (cursor < message.length) parts.push(message.slice(cursor));
  return parts;
}
