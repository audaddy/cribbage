"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline rename. Guests are named by the invite page (or given a stand-in),
 * so this is the one place they can pick something their opponent will
 * recognise.
 */
export function NameEditor({ name, isGuest }: { name: string; isGuest: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: trimmed }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not save that name.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form className="row-wrap" onSubmit={save} style={{ gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 160, maxWidth: 260 }}
          value={value}
          maxLength={40}
          autoFocus
          aria-label="Your display name"
          onChange={(event) => setValue(event.target.value)}
        />
        <button className="btn btn-sm btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          type="button"
          onClick={() => {
            setValue(name);
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </button>
        {error && (
          <span className="tiny" style={{ color: "var(--danger)" }} role="alert">
            {error}
          </span>
        )}
      </form>
    );
  }

  return (
    <p className="small muted">
      Playing as <strong>{name}</strong>
      {isGuest ? " (guest)" : ""}{" "}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setEditing(true)}
      >
        Change name
      </button>
    </p>
  );
}
