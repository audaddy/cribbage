import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cribbage",
  description:
    "Play two-handed cribbage with a friend, a move at a time. Start a game, share the link, come back whenever it is your turn.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2efe7" },
    { media: "(prefers-color-scheme: dark)", color: "#14161a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              ♠
            </span>
            Cribbage
          </Link>
        </header>
        {children}
      </body>
    </html>
  );
}
