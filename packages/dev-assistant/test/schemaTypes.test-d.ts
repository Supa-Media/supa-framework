/**
 * TYPE-LEVEL regression test — guards the secondary schema-typing defect:
 * `supaDevAssistantTables()` was annotated `Record<string, TableDefinition>`,
 * which erased the concrete `devBugs` / `devBugMessages` keys from a consumer's
 * generated `DataModel` (forcing a cast at the `defineSchema` call site).
 *
 * Not executed at runtime (`*.test-d.ts`); compiled by
 * `tsconfig.typecheck.json`. A compile error here IS the failing test.
 *
 * Asserts that spreading the factory into `defineSchema` yields concrete table
 * keys AND that consumer-injected `extraBugFields` keep concrete document types.
 */

import {
  defineSchema,
  defineTable,
  type DataModelFromSchemaDefinition,
} from "convex/server";
import { v } from "convex/values";
import { supaDevAssistantTables } from "../src/schema/devAssistantTables";

type Expect<T extends true> = T;

const schema = defineSchema({
  users: defineTable({ firstName: v.optional(v.string()) }),
  // Mirror Togather's mounting: base tables + injected chat-origination FKs.
  ...supaDevAssistantTables({
    extraBugFields: {
      communityId: v.optional(v.id("communities")),
      channelId: v.optional(v.id("chatChannels")),
      threadRootMessageId: v.optional(v.id("chatMessages")),
    },
    extraBugIndexes: [{ name: "by_channel", fields: ["channelId"] }],
  }),
});

type DM = DataModelFromSchemaDefinition<typeof schema>;

// Concrete table keys survive into the DataModel (no cast needed).
type _tableKeys = [
  Expect<"devBugs" extends keyof DM ? true : false>,
  Expect<"devBugMessages" extends keyof DM ? true : false>,
];

type BugDoc = DM["devBugs"]["document"];
type MessageDoc = DM["devBugMessages"]["document"];

// Base fields keep concrete types.
type _baseFields = [
  Expect<"status" extends keyof BugDoc ? true : false>,
  Expect<BugDoc extends { title: string } ? true : false>,
  Expect<BugDoc extends { originatorUserId: unknown } ? true : false>,
  Expect<MessageDoc extends { body: string } ? true : false>,
];

// Consumer-injected extra fields flow through the generic (concrete, not erased).
type _extraFields = [
  Expect<"communityId" extends keyof BugDoc ? true : false>,
  Expect<"channelId" extends keyof BugDoc ? true : false>,
  Expect<"threadRootMessageId" extends keyof BugDoc ? true : false>,
];

// A no-arg call must still produce the two concrete table keys.
const baseOnly = supaDevAssistantTables();
type _baseOnlyKeys = [
  Expect<"devBugs" extends keyof typeof baseOnly ? true : false>,
  Expect<"devBugMessages" extends keyof typeof baseOnly ? true : false>,
];

export type __SchemaTypeRegression = [
  _tableKeys,
  _baseFields,
  _extraFields,
  _baseOnlyKeys,
];
