/**
 * Payment Tables
 *
 * Schema tables for Stripe customer mapping and subscription state.
 *
 * Usage:
 * ```ts
 * import { defineSchema } from "convex/server";
 * import { supaAuthTables, supaPaymentTables } from "@supa-media/convex/schema";
 *
 * export default defineSchema({
 *   ...supaAuthTables,
 *   ...supaPaymentTables,
 * });
 * ```
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const supaPaymentTables = {
  /** Stripe customer mapping — links Convex users to Stripe customers. */
  customers: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    createdAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"]),

  /** Subscription state — tracks active Stripe subscriptions. */
  subscriptions: defineTable({
    userId: v.id("users"),
    stripeSubscriptionId: v.string(),
    status: v.string(),
    priceId: v.optional(v.string()),
    productId: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_stripeSubscriptionId", ["stripeSubscriptionId"])
    .index("by_status", ["status"]),
};
