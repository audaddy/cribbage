/**
 * Turn notifications.
 *
 * Two delivery paths, both optional and both fired from the same hook:
 *   - `NOTIFY_WEBHOOK_URL` receives a JSON payload (wire it to push, Discord,
 *     Slack, or your own relay).
 *   - `EMAIL_WEBHOOK_URL` sends a plain email.
 *
 * A `Notification` row keyed on the game version makes the hook idempotent, so
 * a retried request never notifies the same turn twice.
 */

import type { Game, User } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { sendEmail } from "./mail";

export type NotificationType = "your_turn" | "game_over" | "invite_accepted";

interface NotifyInput {
  game: Game;
  recipient: User;
  opponent: User | null;
  type: NotificationType;
  summary: string;
}

export async function notify({
  game,
  recipient,
  opponent,
  type,
  summary,
}: NotifyInput): Promise<void> {
  // Claim the notification first; a duplicate key means it already went out.
  try {
    await prisma.notification.create({
      data: {
        userId: recipient.id,
        gameId: game.id,
        type,
        gameVersion: game.version,
      },
    });
  } catch {
    return;
  }

  const url = `${env.appUrl}/games/${game.id}`;
  const payload = {
    type,
    gameId: game.id,
    url,
    summary,
    recipient: { id: recipient.id, email: recipient.email, name: recipient.displayName },
    opponent: opponent
      ? { id: opponent.id, name: opponent.displayName }
      : null,
    scores: [game.score0, game.score1],
  };

  const tasks: Promise<unknown>[] = [];

  const webhook = env.notifyWebhook;
  if (webhook) {
    tasks.push(
      fetch(webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(webhook.token ? { authorization: `Bearer ${webhook.token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      }).catch((error) => console.error("[notify] webhook failed", error)),
    );
  }

  // A guest has no email; the webhook is still fired for them.
  if (env.email && recipient.email) {
    tasks.push(
      sendEmail({
        to: recipient.email,
        subject:
          type === "your_turn"
            ? `Your turn — Cribbage vs ${opponent?.displayName ?? "your opponent"}`
            : type === "game_over"
              ? "Your Cribbage game has finished"
              : "Your Cribbage invite was accepted",
        text: `${summary}\n\n${url}\n`,
      }),
    );
  }

  if (tasks.length === 0) {
    console.info(`[notify] ${type} → ${recipient.email}: ${summary} (${url})`);
    return;
  }

  await Promise.allSettled(tasks);
}
