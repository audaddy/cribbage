/** Centralised, validated access to environment configuration. */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function number(name: string, fallback: number): number {
  const raw = optional(name);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * Secret used to sign session cookies and hash magic-link tokens. A missing
 * secret is fatal in production; development falls back to a fixed string so
 * `npm run dev` works with no setup.
 */
function authSecret(): string {
  const secret = optional("AUTH_SECRET");
  if (secret) return secret;
  if (isProduction) {
    throw new Error(
      "AUTH_SECRET is required in production. Generate one with `openssl rand -base64 48`.",
    );
  }
  return "insecure-development-secret";
}

export const env = {
  isProduction,
  get authSecret() {
    return authSecret();
  },
  get appUrl() {
    return (optional("APP_URL") ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get magicLinkTtlMinutes() {
    return number("MAGIC_LINK_TTL_MINUTES", 15);
  },
  get sessionTtlDays() {
    return number("SESSION_TTL_DAYS", 30);
  },
  /** In development, show the magic link on screen instead of emailing it. */
  get echoMagicLink() {
    return !isProduction && optional("DEV_ECHO_MAGIC_LINK") !== "false";
  },
  get email() {
    const url = optional("EMAIL_WEBHOOK_URL");
    return url
      ? {
          url,
          token: optional("EMAIL_WEBHOOK_TOKEN"),
          from: optional("EMAIL_FROM") ?? "Cribbage <cribbage@example.com>",
        }
      : null;
  },
  get notifyWebhook() {
    const url = optional("NOTIFY_WEBHOOK_URL");
    return url ? { url, token: optional("NOTIFY_WEBHOOK_TOKEN") } : null;
  },
};
