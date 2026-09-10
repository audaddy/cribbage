/**
 * Web push delivery.
 *
 * Chosen over email or SMS because it needs no third-party account and no
 * carrier registration, and — unlike email — it reaches a guest, who by design
 * has no address to write to. A subscription belongs to a browser, which is
 * exactly the same thing a guest account is.
 */

import webpush from "web-push";
import { prisma } from "./db";
import { env } from "./env";

let configured: boolean | null = null;

/** Configures web-push once, and reports whether keys are present at all. */
function ready(): boolean {
  if (configured !== null) return configured;
  const keys = env.vapid;
  if (!keys) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  configured = true;
  return true;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Collapses replaced notifications, so one game never stacks up. */
  tag: string;
}

/**
 * Sends to every browser this user has registered.
 *
 * A 404 or 410 means the push service has retired that endpoint — the browser
 * was uninstalled, or permission revoked — so the row is deleted rather than
 * retried forever.
 */
export async function pushToUser(userId: string, message: PushMessage): Promise<number> {
  if (!ready()) return 0;

  const devices = await prisma.pushSubscription.findMany({ where: { userId } });
  if (devices.length === 0) return 0;

  const payload = JSON.stringify(message);
  let delivered = 0;

  await Promise.all(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth },
          },
          payload,
        );
        delivered += 1;
        await prisma.pushSubscription.update({
          where: { id: device.id },
          data: { lastSeenAt: new Date() },
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: device.id } })
            .catch(() => undefined);
        } else {
          console.error("[push] send failed", status ?? error);
        }
      }
    }),
  );

  return delivered;
}
