"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The brand bar, everywhere except a television.
 *
 * A TV screen is entirely given over to the board, and a navigation link is
 * useless on a device with no pointer — so the header steps aside there rather
 * than eating a strip of a screen people are reading from across a room.
 */
export function SiteHeader() {
  const pathname = usePathname();
  if (pathname?.startsWith("/tv/")) return null;

  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 100 100" width="18" height="18">
            <path
              d="M50 8C50 8 13 37 13 58c0 13 10 21 21 21 7 0 12-3 15-8-1 10-5 17-13 22h28c-8-5-12-12-13-22 3 5 8 8 15 8 11 0 21-8 21-21C87 37 50 8 50 8Z"
              fill="currentColor"
            />
          </svg>
        </span>
        Cribbage
      </Link>
    </header>
  );
}
