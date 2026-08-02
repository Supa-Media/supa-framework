import { ConvexError, v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { MAX_CLOCK_SKEW_MS } from "./lib/auth";
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
 * What a caller is told when its clock is ahead of ours. Spelled once, because
 * `convex/http.ts` turns it into a 400 and this mutation throws it, and a second
 * wording would be a second thing to keep true.
 */
export const CLOCK_AHEAD_MESSAGE =
  "updatedAt is more than 5 minutes in the future — this device's clock looks wrong";

/**
 * Move the marker, last-write-wins by `updatedAt`.
 *
 * **Why the writer's clock is allowed to decide, in one direction only.**
 * `updatedAt` comes from the browser, and the requirement it exists for is
 * *past*-dated: an offline phone that marked reviewed at 07:00 and syncs at
 * 09:00 must not overwrite the laptop's genuine 08:00 mark. Using the server
 * clock would break that. Tolerating the *future* buys that requirement nothing
 * and costs everything — `Date.now() * 1000` is an ordinary unit slip, and it
 * used to be accepted, pinning the marker at the year 58554 and making every
 * later honest write `applied: false` forever. The remedy this comment used to
 * suggest ("mark reviewed again from a device with a sane clock") is the one
 * thing that provably could not work, because a sane clock produces a
 * *smaller* number. Recovery meant editing the row by hand.
 *
 * So the future is bounded by the same `MAX_CLOCK_SKEW_MS` the signature layer
 * already allows a request, and a caller past it is told which of the two
 * clocks we think is wrong.
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
    /** The server's clock, supplied by the caller so this stays deterministic. */
    now: v.number(),
  },
  returns: v.object({ applied: v.boolean(), state: reviewStateValidator }),
  handler: async (ctx, args) => {
    if (Number.isNaN(new Date(args.lastReviewedAt).getTime())) {
      throw new ConvexError(`lastReviewedAt is not a date: ${args.lastReviewedAt}`);
    }
    if (!Number.isFinite(args.updatedAt)) {
      throw new ConvexError("updatedAt must be unix milliseconds");
    }
    // The HTTP layer checks this too, and answers 400 rather than 500. This one
    // is the invariant: the table must not be able to hold an unreachable
    // `updatedAt` no matter which door a future caller comes through.
    if (args.updatedAt > args.now + MAX_CLOCK_SKEW_MS) {
      throw new ConvexError(CLOCK_AHEAD_MESSAGE);
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
