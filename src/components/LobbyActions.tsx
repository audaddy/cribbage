"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TurnAlerts } from "./TurnAlerts";

/**
 * The three tables you can sit at. Three-handed deals a card straight to the
 * crib to make up the difference; partnership play puts partners opposite each
 * other, sharing one peg.
 */
const VARIANT_CHOICES = [
  { value: "two" as const, name: "Two players", hint: "The usual game" },
  { value: "three" as const, name: "Three players", hint: "Every player alone" },
  { value: "teams" as const, name: "Four, in teams", hint: "Partners opposite" },
];

const NEW_GAME_LABEL: Record<"two" | "three" | "teams", string> = {
  two: "New game",
  three: "New 3-player game",
  teams: "New team game",
};

/** New-game and join-by-code controls, plus sign out. */
export function LobbyActions({ isGuest = false }: { isGuest?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "new" | "cpu" | "join" | "out">(null);
  const [variant, setVariant] = useState<"two" | "three" | "teams">("two");
  const [code, setCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Both buttons open a game; only the endpoint differs. */
  async function start(kind: "new" | "cpu") {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(
        kind === "cpu" ? "/api/games/cpu" : "/api/games",
        kind === "cpu"
          ? { method: "POST" }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ variant }),
            },
      );
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
    // A guest has no email to sign back in with: the cookie is the account.
    if (
      isGuest &&
      !window.confirm(
        "You are playing as a guest, so this browser session is the only way " +
          "back into your games. Sign out anyway?",
      )
    ) {
      return;
    }
    setBusy("out");
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="stack-sm">
      <div className="variant-picker" role="radiogroup" aria-label="Game type">
        {VARIANT_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={variant === choice.value}
            className="variant-option"
            onClick={() => setVariant(choice.value)}
            disabled={busy !== null}
          >
            <span className="variant-name">{choice.name}</span>
            <span className="variant-hint">{choice.hint}</span>
          </button>
        ))}
      </div>

      <div className="row-wrap">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void start("new")}
          disabled={busy !== null}
        >
          {busy === "new" ? "Starting…" : NEW_GAME_LABEL[variant]}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void start("cpu")}
          disabled={busy !== null}
        >
          {busy === "cpu" ? "Dealing…" : "Play the computer"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setShowJoin((value) => !value)}
          disabled={busy !== null}
        >
          Join with a code
        </button>
        <TurnAlerts />
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
