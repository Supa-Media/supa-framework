import { defineSchema } from "convex/server";
import { {{SCHEMA_IMPORTS}} } from "@supa-media/convex/schema";

/**
 * Database schema for {{APP_NAME}}.
 *
 * Spreads the framework's base tables (auth, plus any enabled modules) and is
 * where you add your app-specific tables.
 */
const schema = defineSchema({
  ...supaAuthTables,
{{SCHEMA_SPREAD_LINES}}
  // Add your app-specific tables here, e.g.:
  // myTable: defineTable({
  //   name: v.string(),
  //   userId: v.id("users"),
  // }).index("by_user", ["userId"]),
});

export default schema;
