"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

const ERRORS: Record<string, string> = {
  expired: "That sign-in link has expired or was already used. Request a new one.",
  missing: "That link was incomplete. Request a new one below.",
};

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next");
  const linkError = ERRORS[params.get("error") ?? ""];

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ devUrl?: string; delivered: boolean } | null>(
    null,
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, next }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not send the link.");
        return;
      }
      setSent({ devUrl: body.devUrl, delivered: body.delivered });
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="panel panel-pad stack-sm">
        <h2>Check your email</h2>
        <p className="small muted">
          {sent.delivered
            ? `We sent a sign-in link to ${email}. It works once and expires shortly.`
            : `No mail provider is configured, so the link was written to the server log instead.`}
        </p>
        {sent.devUrl && (
          <>
            <p className="small muted">Development shortcut:</p>
            <a className="btn btn-primary btn-block" href={sent.devUrl}>
              Open the sign-in link
            </a>
          </>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setSent(null)}
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form className="panel panel-pad stack" onSubmit={onSubmit}>
      {linkError && (
        <p className="notice notice-error" role="alert">
          {linkError}
        </p>
      )}
      <div className="field">
        <label className="label" htmlFor="email">
          Email address
        </label>
        <input
          id="email"
          className="input"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
