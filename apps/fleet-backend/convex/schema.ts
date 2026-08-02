import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Two tables, and a deliberately short list of things they are allowed to hold.
 *
 * **GitHub stays the source of truth for work state.** Issues, labels, PRs,
 * runs, review requests — the dashboard reads all of that from the GitHub API
 * and writes it back as labels and comments. None of it is mirrored here.
 * Mirroring it would mean the fleet had two answers to "is this item ready?"
 * and a background job whose whole purpose was to make them agree.
 *
 * What lands here is only what GitHub genuinely cannot hold:
 *
 *   1. `reviewState` — when *you* last did a review. GitHub has no place to put
 *      that (a label saying "seen" would be a write on every glance, visible to
 *      everyone, and wrong the moment you opened a second device).
 *
 *   2. `runEvents` — what the overnight orchestrator, watchdog, decider and
 *      gardeners saw *while running*. GitHub records the outcome of a run; it
 *      does not record that the watchdog woke at 03:12, diagnosed a stall, and
 *      respawned the agent. That is operational telemetry with no GitHub
 *      object to hang off.
 *
 * Notably absent: an issue-level ⚡ table. ⚡ is the `agent:notify` GitHub label
 * (`fleet-dashboard/src/lib/labels.ts`) and the whole pipeline — dashboard,
 * overnight run, Telegram worker, watchdog — already agrees on it there. A
 * mirror would be a second, quietly diverging opinion about the same flag.
 */

/** Which fleet job wrote an event. Anything else is rejected at ingest. */
export const RUN_EVENT_SOURCES = ["overnight", "watchdog", "decider", "gardener"] as const;
export type RunEventSource = (typeof RUN_EVENT_SOURCES)[number];

export const runEventSource = v.union(
  v.literal("overnight"),
  v.literal("watchdog"),
  v.literal("decider"),
  v.literal("gardener"),
);

/**
 * The one human, as a string sentinel rather than a nullable column.
 *
 * v1 has no accounts: holding `FLEET_READ_TOKEN` *is* being this user. The
 * column exists anyway so that the day a second person gets a token, they get a
 * row rather than a migration.
 */
export const SINGLE_USER_KEY = "owner";

export default defineSchema({
  /**
   * One row per user. Last-write-wins by `updatedAt`, which is the writer's
   * clock — see `convex/reviewState.ts` for why that is safe here and would not
   * be for anything the fleet acts on.
   */
  reviewState: defineTable({
    userKey: v.string(),
    /** ISO-8601. The `since` the dashboard's whole home screen is relative to. */
    lastReviewedAt: v.string(),
    /** Unix ms. The merge clock — the newest write wins, ties keep the stored row. */
    updatedAt: v.number(),
    /** Free text from the browser ("iPhone", "MacBook"), so a surprise is traceable. */
    device: v.string(),
    /**
     * Room for cross-device preferences that are genuinely about the person and
     * have nowhere in GitHub to live. Empty in v1 — the dashboard writes no key
     * yet — and deliberately a flat string map rather than a typed column per
     * preference, so adding one is a dashboard change and not a migration.
     *
     * An issue's ⚡ does NOT belong here. See the note at the top of this file.
     */
    prefs: v.optional(v.record(v.string(), v.string())),
  }).index("by_user", ["userKey"]),

  /**
   * Append-only. Nothing updates or deletes a row; reads are windowed (see
   * `convex/runEvents.ts`) so the table growing forever never becomes a query
   * that scans forever.
   */
  runEvents: defineTable({
    source: runEventSource,
    /** `owner/name`, lowercased — the same merge key `ProjectSnapshot.key` uses. */
    repo: v.string(),
    /** The issue or PR the event is about, when it is about one. */
    issueNumber: v.optional(v.number()),
    /** Writer-defined, e.g. `wake`, `respawn`, `parked`, `decision`. Free text on purpose. */
    kind: v.string(),
    /** Unix ms, per the writer — when the thing happened. */
    at: v.number(),
    /** Unix ms, per the server — when we heard about it. */
    receivedAt: v.number(),
    /** Deep link to the run, when the writer knows one. */
    url: v.optional(v.string()),
    /**
     * Idempotency key. A writer that can be retried supplies one and gets
     * at-most-once insertion; one that cannot, omits it and gets append.
     */
    dedupeKey: v.optional(v.string()),
    /** Small, flat-ish detail bag. Size-capped at the HTTP boundary, not here. */
    payload: v.optional(v.record(v.string(), v.any())),
  })
    .index("by_at", ["at"])
    .index("by_repo_at", ["repo", "at"])
    .index("by_dedupe", ["dedupeKey"]),
});
