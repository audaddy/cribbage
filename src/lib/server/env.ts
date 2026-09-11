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
 * Resend's shared sender. It needs no DNS setup, but delivers only to the
 * address that owns the Resend account — enough for your own sign-in links,
 * not enough to write to a second player. Set `EMAIL_FROM` to an address at a
 * domain you have verified to reach anyone.
 */
const DEFAULT_SENDER = "Cribbage <onboarding@resend.dev>";

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
  /**
   * Public origin. Invite and sign-in links are built from it, so getting it
   * wrong means texting people links that point somewhere useless.
   *
   * On Vercel this can be inferred: VERCEL_PROJECT_PRODUCTION_URL is the
   * project's stable production domain, which is exactly what an invite link
   * needs. (VERCEL_URL is deliberately not used — it changes with every
   * deployment, so links built from it would rot.) Setting APP_URL explicitly
   * still wins, which is what a custom domain needs.
   */
  get appUrl() {
    const explicit = optional("APP_URL");
    if (explicit) return explicit.replace(/\/$/, "");

    const vercel = optional("VERCEL_PROJECT_PRODUCTION_URL");
    if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

    return "http://localhost:3000";
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
  /**
   * Outbound mail, configured either way round.
   *
   * `EMAIL_WEBHOOK_URL` points at any provider that accepts a JSON POST and
   * always wins. Failing that, `RESEND_API_KEY` alone is enough: that is the
   * variable Vercel's Resend integration injects when you install it, so a
   * one-click install needs no further configuration here.
   */
  get email() {
    const url = optional("EMAIL_WEBHOOK_URL");
    if (url) {
      return {
        url,
        token: optional("EMAIL_WEBHOOK_TOKEN") ?? optional("RESEND_API_KEY"),
        from: optional("EMAIL_FROM") ?? DEFAULT_SENDER,
      };
    }
    const resend = optional("RESEND_API_KEY");
    return resend
      ? {
          url: "https://api.resend.com/emails",
          token: resend,
          from: optional("EMAIL_FROM") ?? DEFAULT_SENDER,
        }
      : null;
  },
  /**
   * Web push signing keys. Generated once with `npx web-push generate-vapid-keys`
   * and stored as environment variables; without them push is simply off and
   * every other delivery path still works.
   */
  get vapid() {
    const publicKey = optional("VAPID_PUBLIC_KEY");
    const privateKey = optional("VAPID_PRIVATE_KEY");
    if (!publicKey || !privateKey) return null;
    return {
      publicKey,
      privateKey,
      // Push services want a contact for the sender; mailto: is the convention.
      subject: optional("VAPID_SUBJECT") ?? "mailto:noreply@example.com",
    };
  },
  get notifyWebhook() {
    const url = optional("NOTIFY_WEBHOOK_URL");
    return url ? { url, token: optional("NOTIFY_WEBHOOK_TOKEN") } : null;
  },
};
