import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createGuestUser, currentUser } from "@/lib/server/auth";
import { LoginForm } from "@/components/LoginForm";
import { PlayingCard } from "@/components/PlayingCard";

export const metadata = { title: "Sign in — Cribbage" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await currentUser()) redirect("/games");
  const { next } = await searchParams;

  async function startAsGuest() {
    "use server";
    await createGuestUser();
    // Only same-origin paths are honoured, so this cannot bounce elsewhere.
    redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/games");
  }
  return (
    <main className="shell shell--narrow stack">
      <div className="hand hand--tiny" aria-hidden="true">
        {["AS", "5H", "JC"].map((card, index) => (
          <span
            key={card}
            className="hand-card hand-card--dealing"
            style={
              {
                "--angle": `${(index - 1) * 9}deg`,
                "--arc": `${(index - 1) ** 2 * 4}px`,
                "--i": index,
              } as React.CSSProperties
            }
          >
            <PlayingCard card={card} size="sm" />
          </span>
        ))}
      </div>

      <div className="stack-sm">
        <h1>Sign in</h1>
        <p className="muted small">
          Enter your email and we will send you a link that signs you straight
          in. No password, no account to set up.
        </p>
      </div>
      <Suspense fallback={<div className="panel panel-pad small muted">Loading…</div>}>
        <LoginForm />
      </Suspense>

      <div className="or-rule">
        <span>or</span>
      </div>

      <form action={startAsGuest} className="stack-sm">
        <button className="btn btn-block" type="submit">
          Start playing without an account
        </button>
        <p className="tiny muted" style={{ textAlign: "center" }}>
          This browser remembers you for 30 days. Sign in by email later and
          your games come with you.
        </p>
      </form>
    </main>
  );
}
