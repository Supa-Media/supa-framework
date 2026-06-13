/**
 * Rate Limiting
 *
 * Database-backed rate limiter using a sliding window counter.
 * Designed for brute-force prevention on OTP and auth endpoints.
 *
 * Requires a `rateLimits` table in your schema:
 * ```ts
 * import { supaRateLimitTable } from "@supa-media/convex/lib";
 *
 * export default defineSchema({
 *   ...supaRateLimitTable,
 *   // other tables...
 * });
 * ```
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Rate limit table definition — spread into your schema. */
export const supaRateLimitTable = {
  rateLimits: defineTable({
    key: v.string(),
    attempts: v.number(),
    windowStart: v.number(),
  }).index("by_key", ["key"]),
};

/**
 * Minimal mutation context interface for rate limiting.
 * Works with any Convex mutation context without requiring generated types.
 */
interface RateLimitCtx {
  db: {
    query: (table: string) => any;
    insert: (table: string, doc: any) => Promise<any>;
    patch: (id: any, fields: any) => Promise<void>;
  };
}

/**
 * Check and increment a rate limit counter.
 *
 * Throws a generic "Too many attempts" error if the caller has exceeded
 * `maxAttempts` within `windowMs`. The counter auto-resets when the window expires.
 *
 * @param ctx - Convex mutation context (needs DB read/write)
 * @param key - Rate limit key, e.g. "otp:+12025550123"
 * @param maxAttempts - Max allowed attempts within the window
 * @param windowMs - Window duration in milliseconds
 */
export async function checkRateLimit(
  ctx: RateLimitCtx,
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<void> {
  const now = Date.now();

  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q: any) => q.eq("key", key))
    .first();

  if (existing) {
    const windowExpired = now - existing.windowStart >= windowMs;

    if (windowExpired) {
      await ctx.db.patch(existing._id, {
        attempts: 1,
        windowStart: now,
      });
      return;
    }

    if (existing.attempts >= maxAttempts) {
      throw new Error("Too many attempts. Please try again later.");
    }

    await ctx.db.patch(existing._id, {
      attempts: existing.attempts + 1,
    });
    return;
  }

  await ctx.db.insert("rateLimits", {
    key,
    attempts: 1,
    windowStart: now,
  });
}
