"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** New-game and join-by-code controls, plus sign out. */
export function LobbyActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "new" | "join" | "out">(null);
  const [code, setCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function newGame() {
    setBusy("new");
    setError(null);
    try {
      const response = await fetch("/api/games", { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not start a game.");
        return;
      }
      router.push(`/games/${body.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    setBusy("join");
    setError(null);
    try {
      const response = await fetch("/api/games/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not join that game.");
        return;
      }
      router.push(`/games/${body.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy("out");
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="stack-sm">
      <div className="row-wrap">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void newGame()}
          disabled={busy !== null}
        >
          {busy === "new" ? "Starting…" : "New game"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setShowJoin((value) => !value)}
          disabled={busy !== null}
        >
          Join with a code
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void signOut()}
          disabled={busy !== null}
        >
          Sign out
        </button>
      </div>

      {showJoin && (
        <form className="row-wrap" onSubmit={join}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 180, textTransform: "uppercase" }}
            placeholder="Invite code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-label="Invite code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="btn" type="submit" disabled={busy !== null || !code}>
            {busy === "join" ? "Joining…" : "Join"}
          </button>
        </form>
      )}

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
