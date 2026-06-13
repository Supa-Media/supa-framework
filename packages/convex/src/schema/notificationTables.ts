/**
 * Notification Tables
 *
 * Schema tables for push notification token storage and outbound notification queue.
 *
 * Usage:
 * ```ts
 * import { defineSchema } from "convex/server";
 * import { supaAuthTables, supaNotificationTables } from "@supa-media/convex/schema";
 *
 * export default defineSchema({
 *   ...supaAuthTables,
 *   ...supaNotificationTables,
 * });
 * ```
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const supaNotificationTables = {
  /**
   * Device push tokens per user.
   * Each device registration creates a row. Users may have multiple devices.
   */
  pushTokens: defineTable({
    userId: v.id("users"),
    token: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android"), v.literal("web")),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_token", ["token"]),

  /**
   * Outbound notification queue.
   * Notifications are enqueued here and processed by a cron or scheduled function.
   */
  notificationQueue: defineTable({
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    image: v.optional(v.string()),
    deepLink: v.optional(v.string()),
    data: v.optional(v.any()),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_userId", ["userId"])
    .index("by_status_createdAt", ["status", "createdAt"]),
};
