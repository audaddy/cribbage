/** Shared helpers for the JSON API: responses, body parsing, error mapping. */

import { NextResponse } from "next/server";
import { IllegalMoveError } from "@/lib/cribbage";
import { UnauthorizedError } from "./auth";
import { GameAccessError, GameConflictError } from "./games";

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Maps domain errors onto status codes; anything else is a 500. */
export function handleError(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) return fail(error.message, 401);
  if (error instanceof GameAccessError) return fail(error.message, 403);
  if (error instanceof GameConflictError) return fail(error.message, 409);
  if (error instanceof IllegalMoveError) return fail(error.message, 422);
  console.error("[api] unhandled error", error);
  return fail("Something went wrong. Please try again.", 500);
}

export async function readJson<T = Record<string, unknown>>(
  request: Request,
): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

/**
 * A small fixed-window rate limiter held in process memory. Good enough to
 * blunt magic-link spam on a single free-tier instance; swap for a shared
 * store (Redis/Upstash) if the app is ever scaled horizontally.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "local";
  return `${scope}:${ip}`;
}
