/**
 * Passwordless authentication.
 *
 * Two ways in:
 *   - A magic link sent to an email address (below).
 *   - Accepting an invite link, which creates a guest account on the spot with
 *     no email at all. A guest is identified purely by their session cookie,
 *     which is what makes "text someone a link and start playing" work.
 *
 * Magic-link flow:
 *   1. The player submits an email address.
 *   2. A random token is generated; only its SHA-256 hash is stored.
 *   3. The token is emailed as a link (or echoed to the page in development).
 *   4. Following the link consumes the token once and issues a session cookie.
 *
 * Sessions are stateless: an HMAC-signed `userId|expiry` payload in an
 * httpOnly cookie. That keeps the free tier cheap — no session table, no
 * round-trip to validate — at the cost of not being able to revoke a single
 * session early. Rotating AUTH_SECRET invalidates every session at once.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";

export const SESSION_COOKIE = "cribbage_session";

// --- token helpers ---------------------------------------------------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hmac(payload: string): string {
  return base64url(createHmac("sha256", env.authSecret).update(payload).digest());
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(`${token}:${env.authSecret}`).digest("hex");
}

// --- session cookies -------------------------------------------------------

export function signSession(userId: string): string {
  const expiresAt = Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000;
  const payload = base64url(JSON.stringify({ uid: userId, exp: expiresAt }));
  return `${payload}.${hmac(payload)}`;
}

export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!safeEquals(signature, hmac(payload))) return null;

  try {
    const { uid, exp } = JSON.parse(fromBase64url(payload).toString()) as {
      uid?: string;
      exp?: number;
    };
    if (!uid || !exp || Date.now() > exp) return null;
    return uid;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: env.sessionTtlDays * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** The signed-in user, or null. Safe to call from pages and route handlers. */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const userId = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

/** Like `currentUser`, but throws — used by API routes behind the auth wall. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("You must be signed in.");
    this.name = "UnauthorizedError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** Turns "ada.lovelace@example.com" into "Ada Lovelace". */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "player";
  const words = local
    .replace(/[._-]+/g, " ")
    .replace(/\d+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "Player";
  return words
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 40);
}

// --- guests ----------------------------------------------------------------

const GUEST_ADJECTIVES = [
  "Amber", "Brisk", "Clever", "Copper", "Dusty", "Eager", "Golden", "Hasty",
  "Jolly", "Keen", "Lucky", "Merry", "Nimble", "Quiet", "Rapid", "Silver",
  "Steady", "Swift", "Sunny", "Wily",
];

const GUEST_NOUNS = [
  "Badger", "Crane", "Falcon", "Fox", "Heron", "Kestrel", "Magpie", "Marten",
  "Otter", "Owl", "Raven", "Robin", "Sparrow", "Stoat", "Thrush", "Weasel",
  "Wren", "Hare",
];

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]!;
}

/** A friendly stand-in name, offered as the default when joining by invite. */
export function suggestGuestName(): string {
  return `${pick(GUEST_ADJECTIVES)} ${pick(GUEST_NOUNS)}`;
}

/**
 * Creates a passwordless, email-less account and signs it in.
 *
 * The session cookie is the only credential, so clearing site data or moving
 * to another device loses access. That is the deliberate trade for a link a
 * friend can tap once and be playing.
 */
export async function createGuestUser(displayName?: string): Promise<User> {
  const name = (displayName ?? "").trim() || suggestGuestName();
  const user = await prisma.user.create({
    data: { displayName: name.slice(0, 40), isGuest: true },
  });
  await setSessionCookie(user.id);
  return user;
}

// --- magic links -----------------------------------------------------------

export interface MagicLink {
  url: string;
  expiresAt: Date;
}

export async function createMagicLink(
  rawEmail: string,
  redirectTo?: string,
): Promise<MagicLink> {
  const email = normalizeEmail(rawEmail);
  const token = base64url(randomBytes(32));
  const expiresAt = new Date(Date.now() + env.magicLinkTtlMinutes * 60 * 1000);

  await prisma.loginToken.create({
    data: { tokenHash: hashToken(token), email, expiresAt },
  });

  // Opportunistically sweep expired tokens; cheap and keeps the table small.
  await prisma.loginToken
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } })
    .catch(() => undefined);

  const url = new URL("/auth/callback", env.appUrl);
  url.searchParams.set("token", token);
  if (redirectTo && redirectTo.startsWith("/")) {
    url.searchParams.set("next", redirectTo);
  }
  return { url: url.toString(), expiresAt };
}

/**
 * Redeems a magic-link token, creating the account on first sign-in.
 * Tokens are single-use: the row is marked consumed inside the same query that
 * checks it, so a replayed link cannot mint a second session.
 *
 * `claimant` is the guest currently holding this browser's session, if any.
 * When one is present the email is attached to that account rather than
 * starting a fresh one — otherwise a guest who later signed in by email would
 * silently land in a different account and lose every game they had played.
 */
export async function consumeMagicLink(
  token: string,
  claimant?: User | null,
): Promise<User | null> {
  const tokenHash = hashToken(token);
  const record = await prisma.loginToken.findUnique({ where: { tokenHash } });
  if (!record || record.consumedAt || record.expiresAt < new Date()) return null;

  const claimed = await prisma.loginToken.updateMany({
    where: { tokenHash, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  if (claimant?.isGuest) {
    // Only if nobody already owns that address — otherwise the right answer is
    // to sign into the existing account, which the upsert below does.
    const taken = await prisma.user.findUnique({ where: { email: record.email } });
    if (!taken) {
      return prisma.user.update({
        where: { id: claimant.id },
        data: { email: record.email, isGuest: false },
      });
    }
  }

  return prisma.user.upsert({
    where: { email: record.email },
    update: { isGuest: false },
    create: {
      email: record.email,
      displayName: nameFromEmail(record.email),
      isGuest: false,
    },
  });
}
