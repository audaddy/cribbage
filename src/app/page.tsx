import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";

export default async function HomePage() {
  const user = await currentUser();
  if (user) redirect("/games");

  return (
    <main className="shell shell--narrow stack">
      <div className="stack-sm" style={{ paddingTop: 24 }}>
        <h1>Cribbage, a move at a time.</h1>
        <p className="muted">
          Two-handed cribbage played the way postal chess used to be. Deal a
          hand, lay your cards away, and come back when it is your turn. Your
          games wait for you.
        </p>
      </div>

      <hr className="hero-rule" />

      <ul className="stack-sm small muted" style={{ paddingLeft: 18, margin: 0 }}>
        <li>Full rules: the crib, the cut, pegging to 31, and the show.</li>
        <li>Every hand scored automatically, with a breakdown of each point.</li>
        <li>Run as many games at once as you have friends to play.</li>
        <li>Sign in with an email link — no password to remember.</li>
      </ul>

      <Link className="btn btn-primary btn-block" href="/login">
        Sign in to play
      </Link>
    </main>
  );
}
