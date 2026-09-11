/**
 * Outbound email.
 *
 * There is no hard dependency on a mail provider: `EMAIL_WEBHOOK_URL` accepts
 * any service that takes a JSON POST (Resend, Postmark, Loops, a self-hosted
 * relay). With nothing configured, messages are logged instead — which is all
 * a local dev loop needs.
 */

import { env } from "./env";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(message: OutboundEmail): Promise<boolean> {
  const config = env.email;
  if (!config) {
    console.info(
      `[mail] (no provider configured) to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
    return false;
  }

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // Providers explain refusals in the body, and those explanations are the
      // whole diagnosis: an unverified sender, a sandbox address that may only
      // write to the account owner, a revoked key. A bare status code sends you
      // looking in the wrong place.
      const detail = await response.text().catch(() => "");
      console.error(
        `[mail] provider returned ${response.status} for ${config.from} → ${message.to}` +
          (detail ? `: ${detail.slice(0, 400)}` : ""),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("[mail] delivery failed", error);
    return false;
  }
}

export function magicLinkEmail(to: string, url: string, minutes: number): OutboundEmail {
  return {
    to,
    subject: "Your Cribbage sign-in link",
    text: [
      "Follow this link to sign in to Cribbage:",
      "",
      url,
      "",
      `The link works once and expires in ${minutes} minutes.`,
      "If you did not request it, you can ignore this email.",
    ].join("\n"),
  };
}
