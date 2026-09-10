"use client";

import { useEffect, useState } from "react";

/**
 * Opt-in for "your turn" notifications.
 *
 * State is read from the browser rather than the server: the subscription
 * belongs to *this* browser, so what matters is whether this one is registered,
 * not whether the account has some other device signed up.
 */

type Status =
  | "checking"
  | "unsupported"
  | "ios-needs-install"
  | "off"
  | "on"
  | "blocked"
  | "unavailable";

/** VAPID keys travel as base64url; the Push API wants raw bytes. */
function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  // Backed by a real ArrayBuffer, which is what BufferSource requires.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** iOS grants push only to a site launched from the Home Screen. */
function iosNeedsInstall(): boolean {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  return isIos && !standalone;
}

/** What this browser can do, and whether it is already signed up. */
async function readStatus(): Promise<Status> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return iosNeedsInstall() ? "ios-needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";

  const { publicKey } = (await (await fetch("/api/push/subscribe")).json()) as {
    publicKey: string | null;
  };
  if (!publicKey) return "unavailable";

  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();
  return existing ? "on" : "off";
}

export function TurnAlerts() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);

  // Reading the browser's state is a pure async query; applying it is the
  // effect's job. Keeping them apart means the result can be discarded if the
  // component goes away mid-flight, rather than setting state on nothing.
  useEffect(() => {
    let cancelled = false;

    readStatus().then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      () => {
        if (!cancelled) setStatus("unsupported");
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return;
      }

      const { publicKey } = (await (await fetch("/api/push/subscribe")).json()) as {
        publicKey: string | null;
      };
      if (!publicKey) {
        setStatus("unavailable");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setStatus("on");
    } catch {
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking" || status === "unavailable" || status === "unsupported") {
    return null;
  }

  if (status === "ios-needs-install") {
    return (
      <p className="tiny muted">
        To get a nudge when it is your turn: tap <strong>Share</strong>, then{" "}
        <strong>Add to Home Screen</strong>, and open the game from there.
        iPhones only allow notifications for sites installed that way.
      </p>
    );
  }

  if (status === "blocked") {
    return (
      <p className="tiny muted">
        Notifications are blocked for this site — allow them in your browser
        settings to be told when it is your turn.
      </p>
    );
  }

  return (
    <button
      type="button"
      className={`btn btn-sm${status === "on" ? "" : " btn-primary"}`}
      onClick={() => void (status === "on" ? disable() : enable())}
      disabled={busy}
    >
      <BellIcon muted={status === "on"} />
      {status === "on" ? "Turn alerts on" : "Notify me when it's my turn"}
    </button>
  );
}

function BellIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ opacity: muted ? 0.6 : 1 }}
    >
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
