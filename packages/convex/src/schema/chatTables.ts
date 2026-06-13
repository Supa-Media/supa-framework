/**
 * Chat Tables
 *
 * Schema tables for real-time chat — channels, membership, and messages.
 *
 * Usage:
 * ```ts
 * import { defineSchema } from "convex/server";
 * import { supaAuthTables, supaChatTables } from "@supa-media/convex/schema";
 *
 * export default defineSchema({
 *   ...supaAuthTables,
 *   ...supaChatTables,
 * });
 * ```
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const supaChatTables = {
  /** Chat channels (groups, DMs, etc.). */
  channels: defineTable({
    name: v.optional(v.string()),
    type: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_type", ["type"]),

  /** Channel membership — tracks which users belong to which channels. */
  channelMembers: defineTable({
    channelId: v.id("channels"),
    userId: v.id("users"),
    role: v.optional(v.string()),
    lastReadAt: v.optional(v.number()),
    joinedAt: v.optional(v.number()),
  })
    .index("by_channelId", ["channelId"])
    .index("by_userId", ["userId"])
    .index("by_channelId_userId", ["channelId", "userId"]),

  /** Chat messages. */
  messages: defineTable({
    channelId: v.id("channels"),
    userId: v.id("users"),
    body: v.string(),
    attachments: v.optional(v.array(v.any())),
    replyTo: v.optional(v.id("messages")),
    isEdited: v.optional(v.boolean()),
    isDeleted: v.optional(v.boolean()),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  })
    .index("by_channelId", ["channelId"])
    .index("by_channelId_createdAt", ["channelId", "createdAt"])
    .index("by_userId", ["userId"]),
};
