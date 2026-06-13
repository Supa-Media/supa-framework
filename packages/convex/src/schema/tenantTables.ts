/**
 * Tenant Tables
 *
 * Creates multi-tenant schema tables with configurable names.
 * Provides a tenants table, a userTenants junction table, and
 * adds an activeTenantId concept to the user model.
 *
 * Usage:
 * ```ts
 * import { defineSchema } from "convex/server";
 * import { supaAuthTables, supaTenantTables } from "@supa-media/convex/schema";
 *
 * const tenantTables = supaTenantTables({
 *   tenantName: "organization",
 *   tenantFields: {
 *     website: v.optional(v.string()),
 *   },
 * });
 *
 * export default defineSchema({
 *   ...supaAuthTables,
 *   ...tenantTables,
 * });
 * ```
 */

import { defineTable } from "convex/server";
import { v, type Validator } from "convex/values";

export interface TenantTableConfig {
  /** Name for the tenant entity (e.g. "organization", "workspace", "community"). */
  tenantName: string;
  /** Additional fields to add to the tenant table. */
  tenantFields?: Record<string, Validator<any, any, any>>;
}

/**
 * Generate multi-tenant tables based on config.
 *
 * Returns an object with two table definitions:
 * - `{tenantName}s` — the tenants table (e.g. "organizations")
 * - `user{TenantName}s` — the junction table (e.g. "userOrganizations")
 *
 * The junction table includes:
 * - userId, {tenantName}Id — foreign keys
 * - role — user's role within the tenant
 * - isActive — soft delete flag
 * - joinedAt — when the user joined
 */
export function supaTenantTables(config: TenantTableConfig) {
  const { tenantName, tenantFields = {} } = config;
  const capitalName =
    tenantName.charAt(0).toUpperCase() + tenantName.slice(1);
  const tenantsTableName = `${tenantName}s`;
  const junctionTableName = `user${capitalName}s`;
  const tenantIdField = `${tenantName}Id`;

  const tenantsTable = defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    image: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    ...tenantFields,
  })
    .index("by_slug", ["slug"])
    .index("by_name", ["name"]);

  const junctionTable = defineTable({
    userId: v.id("users"),
    [`${tenantName}Id`]: v.string(), // v.id() requires literal table name; use string for flexibility
    role: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    joinedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index(`by_${tenantIdField}`, [tenantIdField])
    .index(`by_userId_${tenantIdField}`, ["userId", tenantIdField]);

  return {
    [tenantsTableName]: tenantsTable,
    [junctionTableName]: junctionTable,
  } as Record<string, ReturnType<typeof defineTable>>;
}
