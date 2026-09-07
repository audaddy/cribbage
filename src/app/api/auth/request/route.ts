import { createMagicLink, isValidEmail, normalizeEmail } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { clientKey, fail, handleError, json, rateLimit, readJson } from "@/lib/server/http";
import { magicLinkEmail, sendEmail } from "@/lib/server/mail";

/** Issues a sign-in link for an email address. */
export async function POST(request: Request) {
  try {
    const { email, next } = await readJson<{ email?: string; next?: string }>(request);

    if (!email || !isValidEmail(normalizeEmail(email))) {
      return fail("Enter a valid email address.");
    }
    // Every request from a dev machine shares one IP, so the cap is only
    // meaningful — and only enforced tightly — in production.
    const limit = env.isProduction ? 8 : 200;
    if (!rateLimit(clientKey(request, "magic"), limit, 10 * 60 * 1000)) {
      return fail("Too many sign-in requests. Try again in a few minutes.", 429);
    }

    const link = await createMagicLink(email, next);
    const delivered = await sendEmail(
      magicLinkEmail(normalizeEmail(email), link.url, env.magicLinkTtlMinutes),
    );

    return json({
      ok: true,
      delivered,
      // Development convenience: no mail provider needed to sign in locally.
      devUrl: env.echoMagicLink ? link.url : undefined,
      expiresAt: link.expiresAt.toISOString(),
    });
  } catch (error) {
    return handleError(error);
  }
}
