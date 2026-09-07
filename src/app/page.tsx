import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { PlayingCard } from "@/components/PlayingCard";

/** The best hand in cribbage, dealt across the hero. */
const SHOWCASE = ["5H", "5S", "5C", "JD", "5D"];

export default async function HomePage() {
  const user = await currentUser();
  if (user) redirect("/games");

  return (
    <main className="shell shell--narrow stack">
      <section className="hero">
        <div className="hand hero-fan" aria-hidden="true">
          {SHOWCASE.map((card, index) => {
            const middle = (SHOWCASE.length - 1) / 2;
            return (
              <span
                key={card}
                className="hand-card hand-card--dealing"
                style={
                  {
                    "--angle": `${(index - middle) * 7}deg`,
                    "--arc": `${(index - middle) ** 2 * 3.4}px`,
                    "--i": index,
                  } as React.CSSProperties
                }
              >
                <PlayingCard card={card} />
              </span>
            );
          })}
        </div>

        <div className="stack-sm hero-copy">
          <span className="table-label">Twenty-nine. It happens.</span>
          <h1>Cribbage, a move at a time.</h1>
          <p className="small" style={{ opacity: 0.86 }}>
            Two-handed cribbage played the way postal chess used to be. Lay your
            cards away, peg your points, and come back when it is your turn. The
            board waits for you.
          </p>
        </div>
      </section>

      <ul className="feature-list">
        <li>
          <strong>Text someone a link.</strong> They tap it and they are
          playing — no account, no app, no email.
        </li>
        <li>
          <strong>Every point counted for you.</strong> Fifteens, runs, his
          nob, the lot — with a breakdown of where each one came from.
        </li>
        <li>
          <strong>As many games as you have friends.</strong> Each one waits
          patiently for your move.
        </li>
      </ul>

      <Link className="btn btn-primary btn-block" href="/login">
        Sign in to play
      </Link>
      <p className="tiny muted" style={{ textAlign: "center" }}>
        Been invited? Just open the link you were sent.
      </p>
    </main>
  );
}
