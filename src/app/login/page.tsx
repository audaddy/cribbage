import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { LoginForm } from "@/components/LoginForm";
import { PlayingCard } from "@/components/PlayingCard";

export const metadata = { title: "Sign in — Cribbage" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/games");
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
    </main>
  );
}
