"use client";

import { useState } from "react";
import { useIsClient } from "./motion";
import { QrCode } from "./QrCode";

/**
 * How to get the board onto a television.
 *
 * There is no pairing and no app: the TV opens a page like any other. That
 * covers every route people actually have to a screen — a smart TV's own
 * browser, AirPlay or Chromecast mirroring from a laptop, or an HDMI cable —
 * without asking anyone to install anything.
 */
export function CastPanel({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // The address to put on the TV is the one this page was actually loaded
  // from, which only the browser knows — so the panel is client-only rather
  // than rendered once on the server with a guess in it.
  const isClient = useIsClient();
  const tvUrl = isClient ? `${window.location.origin}/tv/${code}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(tvUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard refused — the address is on screen to type */
    }
  }

  if (!isClient) return null;

  return (
    <div className="panel panel-pad stack-sm">
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <span className="table-label">Room {code}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? "Hide" : "Show on TV"}
        </button>
      </div>

      {open && (
        <div className="cast stack-sm">
          <p className="small muted">
            Open this address on the television, or mirror it from a laptop.
            The board and the cut go on the screen; every hand stays on its own
            phone.
          </p>
          <div className="cast-url">
            <code>{tvUrl.replace(/^https?:\/\//, "")}</code>
            <button type="button" className="btn btn-sm" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="cast-qr">
            <QrCode value={tvUrl} size={148} title="Open the television view" />
            <span className="tiny muted">
              Scan from a phone you can mirror, or from the TV&rsquo;s own browser.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
