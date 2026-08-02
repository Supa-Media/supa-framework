import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { runEventSource } from "./schema";

/**
 * The telemetry log: append on write, windowed on read.
 *
 * Internal-only for the same reason as `reviewState` — `convex/http.ts` is the
 * single door, and it is the only place a credential is checked.
 */

/** The most events one read may return. A status board renders far fewer. */
export const MAX_LIMIT = 500;
export const DEFAULT_LIMIT = 200;

/**
 * The furthest back a read may look.
 *
 * The dashboard's whole question is "what happened since my last review", which
 * is hours, not weeks. Thirty days is the ceiling so that a mistyped `since`
 * asks for a bounded scan instead of the entire table — the one query shape
 * that would get slower every night the fleet runs.
 */
export const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const eventValidator = v.object({
  id: v.string(),
  source: runEventSource,
  repo: v.string(),
  issueNumber: v.optional(v.number()),
  kind: v.string(),
  /** ISO-8601, because everything else the dashboard merges against is. */
  at: v.string(),
  url: v.optional(v.string()),
  payload: v.optional(v.record(v.string(), v.any())),
});

const ingestArgs = v.object({
  source: runEventSource,
  repo: v.string(),
  issueNumber: v.optional(v.number()),
  kind: v.string(),
  at: v.number(),
  url: v.optional(v.string()),
  dedupeKey: v.optional(v.string()),
  payload: v.optional(v.record(v.string(), v.any())),
});

/**
 * Append a batch.
 *
 * Reports `inserted` and `deduped` separately rather than returning nothing: a
 * retrying CI job needs to be able to tell "you already had this" from "I wrote
 * it twice", and a `Promise<void>` makes those the same outcome.
 */
export const ingest = internalMutation({
  args: { events: v.array(ingestArgs), receivedAt: v.number() },
  returns: v.object({ inserted: v.number(), deduped: v.number() }),
  handler: async (ctx, args) => {
    let inserted = 0;
    let deduped = 0;

    for (const event of args.events) {
      if (event.dedupeKey !== undefined) {
        const existing = await ctx.db
          .query("runEvents")
          .withIndex("by_dedupe", (q) => q.eq("dedupeKey", event.dedupeKey))
          .first();
        if (existing !== null) {
          deduped += 1;
          continue;
        }
      }
      await ctx.db.insert("runEvents", { ...event, receivedAt: args.receivedAt });
      inserted += 1;
    }

    return { inserted, deduped };
  },
});

/**
 * Read a window, newest first.
 *
 * `since` is clamped rather than rejected. A dashboard asking for six months is
 * asking a reasonable-sounding question with an unreasonable answer, and the
 * useful reply is the last thirty days — not an error that blanks a panel.
 */
export const list = internalQuery({
  args: {
    since: v.number(),
    now: v.number(),
    repo: v.optional(v.string()),
    source: v.optional(runEventSource),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    events: v.array(eventValidator),
    /** The window actually used, so a clamped read can say so out loud. */
    since: v.number(),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const floor = args.now - MAX_WINDOW_MS;
    const since = Math.max(Number.isFinite(args.since) ? args.since : floor, floor);
    const limit = Math.min(
      Math.max(Math.trunc(args.limit ?? DEFAULT_LIMIT), 1),
      MAX_LIMIT,
    );

    const repo = args.repo?.toLowerCase();
    const query =
      repo === undefined
        ? ctx.db.query("runEvents").withIndex("by_at", (q) => q.gte("at", since))
        : ctx.db
            .query("runEvents")
            .withIndex("by_repo_at", (q) => q.eq("repo", repo).gte("at", since));

    // One extra row so `truncated` reports a real cut rather than guessing from
    // a full page — a window whose last event lands exactly on the limit is not
    // truncated, and saying it is would send the reader looking for rows that
    // do not exist.
    const rows = await query
      .order("desc")
      .filter((q) => (args.source === undefined ? true : q.eq(q.field("source"), args.source)))
      .take(limit + 1);

    const page = rows.slice(0, limit);
    return {
      since,
      truncated: rows.length > limit,
      events: page.map((row) => ({
        id: row._id,
        source: row.source,
        repo: row.repo,
        ...(row.issueNumber === undefined ? {} : { issueNumber: row.issueNumber }),
        kind: row.kind,
        at: new Date(row.at).toISOString(),
        ...(row.url === undefined ? {} : { url: row.url }),
        ...(row.payload === undefined ? {} : { payload: row.payload }),
      })),
    };
  },
});
