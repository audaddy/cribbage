import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import Link from "next/link";
import { CardDefs } from "@/components/PlayingCard";
import "./globals.css";

/**
 * Two faces: a warm serif for the brand and headings, which gives the app the
 * feel of a printed game box, and Inter for everything functional — it has
 * real tabular figures, which scores and running totals need.
 */
const display = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Cribbage",
  description:
    "Play two-handed cribbage with a friend, a move at a time. Start a game, share the link, come back whenever it is your turn.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efe9dc" },
    { media: "(prefers-color-scheme: dark)", color: "#12141a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <div className="page-grain" aria-hidden="true" />
        <CardDefs />
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
        {children}
      </body>
    </html>
  );
}
