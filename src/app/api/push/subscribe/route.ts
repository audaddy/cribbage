import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { fail, handleError, json, readJson } from "@/lib/server/http";

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

/** The public key a browser needs before it can subscribe. */
export async function GET() {
  try {
    await requireUser();
    return json({ publicKey: env.vapid?.publicKey ?? null });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Registers this browser for turn notifications.
 *
 * Keyed on the endpoint, so re-subscribing the same browser updates the row it
 * already has instead of accumulating duplicates — which is what happens
 * naturally when a push service rotates an endpoint.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson<SubscribeBody>(request);

    const { endpoint, keys } = body;
    if (!endpoint || !endpoint.startsWith("https://") || !keys?.p256dh || !keys.auth) {
      return fail("That is not a usable push subscription.");
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, lastSeenAt: new Date() },
      create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });

    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

/** Turns notifications off for this browser. */
export async function DELETE(request: Request) {
  try {
    await requireUser();
    const { endpoint } = await readJson<SubscribeBody>(request);
    if (endpoint) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    }
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
