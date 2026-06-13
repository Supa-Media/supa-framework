/**
 * Base Auth Tables
 *
 * Provides `supaAuthTables` — spreads the @convex-dev/auth tables and adds
 * a `users` table with sensible defaults for phone/email OTP apps.
 *
 * Usage:
 * ```ts
 * // convex/schema.ts
 * import { defineSchema } from "convex/server";
 * import { supaAuthTables } from "@supa-media/convex/schema";
 *
 * export default defineSchema({
 *   ...supaAuthTables,
 *   // your other tables...
 * });
 * ```
 */

import { authTables } from "@convex-dev/auth/server";
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const supaAuthTables = {
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phoneVerificationTime: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_phone", ["phone"]),
};
