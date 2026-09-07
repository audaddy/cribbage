import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Sign in — Cribbage" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/games");
  return (
    <main className="shell shell--narrow stack">
      <div className="stack-sm" style={{ paddingTop: 16 }}>
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
