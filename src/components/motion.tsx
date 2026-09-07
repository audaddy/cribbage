"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the viewer has asked for less motion. The media query is an external
 * store, so it is read through useSyncExternalStore rather than mirrored into
 * state — that keeps it correct during SSR and avoids a render just to catch up.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

const noSubscription = () => () => {};

/**
 * False while rendering on the server and through hydration, true afterwards.
 *
 * Decorations built from random numbers must not be server-rendered: the two
 * sides disagree in the last bits of a float and React reports a hydration
 * mismatch. They are also pure ornament, so keeping them out of the HTML
 * payload is the right call regardless.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * Rolls a number towards its new value instead of snapping. Used for the
 * running count, where seeing 22 become 27 is part of reading the play.
 */
export function useCountUp(value: number, ms = 420): number {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value || reduced) return;

    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, ms, reduced]);

  // Honouring the preference is a read, not a state update.
  return reduced ? value : shown;
}

/** Deterministic pseudo-random so a re-render does not reshuffle a burst. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return Math.round((x - Math.floor(x)) * 10000) / 10000;
}

/** Keeps generated CSS values short and stable. */
function px(value: number): string {
  return `${Math.round(value * 10) / 10}px`;
}

/**
 * A short spray of sparks in the scoring player's colour, thrown from the
 * board when points land.
 */
export function Burst({ seat, points }: { seat: 0 | 1; points: number }) {
  const reduced = usePrefersReducedMotion();
  const isClient = useIsClient();
  if (reduced || !isClient) return null;

  // More points, more sparks — a go is a flicker, a 24-hand is a shower.
  const count = Math.min(6 + points * 2, 28);
  const colors =
    seat === 0
      ? ["var(--p0)", "var(--p0-light)", "var(--brass-light)"]
      : ["var(--p1)", "var(--p1-light)", "var(--brass-light)"];

  return (
    <span className="burst" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const angle = rand(i + 1) * Math.PI - Math.PI / 2;
        const distance = 60 + rand(i + 7) * 110;
        return (
          <span
            key={i}
            className="spark"
            style={
              {
                "--dx": px(Math.sin(angle) * distance),
                "--dy": px(-Math.abs(Math.cos(angle)) * distance * 0.75 - 20),
                "--rot": `${Math.round((rand(i + 13) - 0.5) * 720)}deg`,
                "--d": i,
                background: colors[i % colors.length],
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

/** Falling confetti for a finished game. */
export function Confetti({ seat }: { seat: 0 | 1 }) {
  const reduced = usePrefersReducedMotion();
  const isClient = useIsClient();
  if (reduced || !isClient) return null;

  const colors = [
    seat === 0 ? "#c0402a" : "#2a6ea8",
    seat === 0 ? "#e8785f" : "#6aa8dc",
    "#c08b3e",
    "#e3bd76",
    "#2e6f5c",
  ];

  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 70 }, (_, i) => (
        <span
          key={i}
          className="confetto"
          style={
            {
              left: `${Math.round(rand(i + 3) * 1000) / 10}%`,
              background: colors[i % colors.length],
              animationDelay: `${Math.round(rand(i + 11) * 220) / 100}s`,
              animationDuration: `${Math.round((2.8 + rand(i + 17) * 2) * 100) / 100}s`,
              "--spin": `${Math.round((rand(i + 23) - 0.5) * 1400)}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
