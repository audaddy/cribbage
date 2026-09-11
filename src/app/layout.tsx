import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
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
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
