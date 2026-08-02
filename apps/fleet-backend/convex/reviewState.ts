import { ConvexError, v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { SINGLE_USER_KEY } from "./schema";

/**
 * The review marker, and the rule that makes two devices safe.
 *
 * Every function here is `internal`. The HTTP layer (`convex/http.ts`) is the
 * only caller and the only place a credential is checked, so there is exactly
 * one door — a `query` exported as public would be a second one with no lock
 * on it, since v1 has no Convex auth provider to fall back on.
 */

/** The shape the dashboard reads back. `null` before the first mark-reviewed. */
export const reviewStateValidator = v.object({
  lastReviewedAt: v.string(),
  updatedAt: v.number(),
  device: v.string(),
  prefs: v.record(v.string(), v.string()),
});

export const get = internalQuery({
  args: { userKey: v.optional(v.string()) },
  returns: v.union(reviewStateValidator, v.null()),
  handler: async (ctx, args) => {
    const userKey = args.userKey ?? SINGLE_USER_KEY;
    const row = await ctx.db
      .query("reviewState")
      .withIndex("by_user", (q) => q.eq("userKey", userKey))
      .unique();
    if (row === null) return null;
    return {
      lastReviewedAt: row.lastReviewedAt,
      updatedAt: row.updatedAt,
      device: row.device,
      prefs: row.prefs ?? {},
    };
  },
});

/**
 * Move the marker, last-write-wins by `updatedAt`.
 *
 * **Why the writer's clock is allowed to decide.** `updatedAt` comes from the
 * browser, and a browser with a wrong clock could pin the marker into the
 * future. That is survivable here and nowhere else: the marker only widens or
 * narrows *your own* "since last review" window, nothing in the fleet acts on
 * it, and the fix is to mark reviewed again from a device with a sane clock.
 * Using the server clock instead would break the actual requirement — an
 * offline phone that marked reviewed at 07:00 and syncs at 09:00 must not
 * overwrite the laptop's genuine 08:00 mark.
 *
 * Equal timestamps keep the stored row. A tie is a duplicate of a write we
 * already have, and preferring the newcomer would make retrying a request
 * change the answer.
 */
export const set = internalMutation({
  args: {
    userKey: v.optional(v.string()),
    lastReviewedAt: v.string(),
    updatedAt: v.number(),
    device: v.string(),
    prefs: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.object({ applied: v.boolean(), state: reviewStateValidator }),
  handler: async (ctx, args) => {
    if (Number.isNaN(new Date(args.lastReviewedAt).getTime())) {
      throw new ConvexError(`lastReviewedAt is not a date: ${args.lastReviewedAt}`);
    }
    if (!Number.isFinite(args.updatedAt)) {
      throw new ConvexError("updatedAt must be unix milliseconds");
    }

    const userKey = args.userKey ?? SINGLE_USER_KEY;
    const existing = await ctx.db
      .query("reviewState")
      .withIndex("by_user", (q) => q.eq("userKey", userKey))
      .unique();

    if (existing !== null && args.updatedAt <= existing.updatedAt) {
      return {
        applied: false,
        state: {
          lastReviewedAt: existing.lastReviewedAt,
          updatedAt: existing.updatedAt,
          device: existing.device,
          prefs: existing.prefs ?? {},
        },
      };
    }

    // Preferences merge key-by-key rather than replacing the map: a device that
    // has never heard of a preference must not delete it by writing the marker.
    const prefs = { ...(existing?.prefs ?? {}), ...(args.prefs ?? {}) };
    const next = {
      userKey,
      lastReviewedAt: args.lastReviewedAt,
      updatedAt: args.updatedAt,
      device: args.device,
      prefs,
    };

    if (existing === null) await ctx.db.insert("reviewState", next);
    else await ctx.db.patch(existing._id, next);

    return {
      applied: true,
      state: {
        lastReviewedAt: next.lastReviewedAt,
        updatedAt: next.updatedAt,
        device: next.device,
        prefs: next.prefs,
      },
    };
  },
});
