/**
 * Composable schema tables for the dev-assistant contribution pipeline
 * (ADR-029): `devBugs` (the pipeline row + its status machine) and
 * `devBugMessages` (the per-contribution conversation thread).
 *
 * Ported from Togather's `apps/convex/schema.ts`. The Togather-specific
 * chat-origination foreign keys (`communityId`/`channelId`/`threadRootMessageId`
 * → `communities`/`chatChannels`/`chatMessages`) are NOT baked in — the base
 * table references only `users` (which every consumer has). A consumer that
 * also wires the chat-origination flow (like Togather) passes those columns +
 * indexes through the factory's `extraBugFields` / `extraBugIndexes` so the
 * generalized package never hard-references tables a consumer might not own.
 *
 * Usage:
 * ```ts
 * // convex/schema.ts
 * import { defineSchema } from "convex/server";
 * import { v } from "convex/values";
 * import { supaAuthTables } from "@supa-media/convex/schema";
 * import { supaDevAssistantTables } from "@supa-media/dev-assistant/schema";
 *
 * export default defineSchema({
 *   ...supaAuthTables,
 *   ...supaDevAssistantTables(),
 *   // Togather also injects its chat linkage:
 *   // ...supaDevAssistantTables({
 *   //   extraBugFields: {
 *   //     communityId: v.optional(v.id("communities")),
 *   //     channelId: v.optional(v.id("chatChannels")),
 *   //     threadRootMessageId: v.optional(v.id("chatMessages")),
 *   //   },
 *   //   extraBugIndexes: [{ name: "by_channel", fields: ["channelId"] }],
 *   // }),
 * });
 * ```
 *
 * The pipeline also reads two OPTIONAL fields off the `users` table:
 * `githubUsername` (Co-authored-by attribution) and `autoMergeMaxSeverity`
 * (per-user auto-merge cap). Add them to your users table when you adopt Phase 2
 * attribution / Phase 3 auto-merge — see the README.
 */

import { defineTable, type TableDefinition } from "convex/server";
import { v, type Validator } from "convex/values";

export interface DevAssistantTablesConfig {
  /** Extra columns merged into `devBugs` (e.g. a consumer's chat FKs). */
  extraBugFields?: Record<string, Validator<any, any, any>>;
  /** Extra indexes added to `devBugs`. */
  extraBugIndexes?: Array<{ name: string; fields: string[] }>;
}

/**
 * Returns the dev-assistant tables to spread into `defineSchema`. A factory
 * (not a plain object) so consumers can extend `devBugs` with their own columns
 * — mirroring `supaTenantTables` in `@supa-media/convex/schema`.
 */
export function supaDevAssistantTables(
  config: DevAssistantTablesConfig = {},
): Record<string, TableDefinition> {
  const { extraBugFields = {}, extraBugIndexes = [] } = config;

  let devBugs = defineTable({
    // Who filed it. Dashboard items are platform-level (no community/thread);
    // chat-origination FKs, when used, arrive via `extraBugFields`.
    originatorUserId: v.id("users"),

    status: v.union(
      v.literal("DRAFT"),
      v.literal("IN_REVIEW"),
      v.literal("READY_FOR_IMPL"),
      v.literal("IN_PROGRESS"),
      v.literal("CODE_REVIEW"),
      v.literal("READY_TO_MERGE"),
      v.literal("MERGED"),
      v.literal("REJECTED"),
    ),

    title: v.string(),
    body: v.string(), // clean implementation brief (synthesized)
    repro: v.optional(v.string()),
    screenshotUrls: v.optional(v.array(v.string())), // the user's own report images
    planPreviewUrls: v.optional(v.array(v.string())), // AI-generated before/after mock

    // Contributor dev dashboard (ADR-029). All optional for backward compat.
    kind: v.optional(v.union(v.literal("bug"), v.literal("feature"))),
    source: v.optional(v.union(v.literal("chat"), v.literal("dashboard"))),
    riskLevel: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    spec: v.optional(v.string()), // AI-drafted spec, markdown
    specApprovedAt: v.optional(v.number()), // contributor sign-off

    // AI triage fields (ADR-029 Phase 1.5), delivered by the spec-mode routine.
    aiTitle: v.optional(v.string()),
    area: v.optional(v.string()),
    scope: v.optional(
      v.union(
        v.literal("buildable"),
        v.literal("split"),
        v.literal("design_needed"),
      ),
    ),
    verifyOnStaging: v.optional(v.boolean()),
    stagingVerifiedAt: v.optional(v.number()),
    productionRequestedAt: v.optional(v.number()),
    mergeRequestedAt: v.optional(v.number()),
    redoRounds: v.optional(v.number()),
    reviewVerdict: v.optional(
      v.union(v.literal("approved"), v.literal("changes_requested")),
    ),
    reviewSummary: v.optional(v.string()),
    splitSlices: v.optional(
      v.array(v.object({ title: v.string(), prompt: v.string() })),
    ),
    fixRounds: v.optional(v.number()),
    githubIssueNumber: v.optional(v.number()),
    githubIssueUrl: v.optional(v.string()),
    shippedAt: v.optional(v.number()),

    // Deploy observation (ADR-029 follow-up).
    mergeCommitSha: v.optional(v.string()),
    stagingDeploy: v.optional(
      v.object({
        state: v.union(
          v.literal("pending"),
          v.literal("live"),
          v.literal("failed"),
        ),
        workflows: v.optional(
          v.array(
            v.object({
              name: v.string(),
              conclusion: v.optional(v.string()),
            }),
          ),
        ),
        failedWorkflow: v.optional(v.string()),
        updatedAt: v.number(),
      }),
    ),
    productionDeploy: v.optional(
      v.object({
        state: v.union(
          v.literal("pending"),
          v.literal("live"),
          v.literal("failed"),
        ),
        failedWorkflow: v.optional(v.string()),
        requestedAt: v.optional(v.number()),
        updatedAt: v.number(),
      }),
    ),
    archivedAt: v.optional(v.number()),

    prUrl: v.optional(v.string()),
    reviewLink: v.optional(v.string()),
    routineRunId: v.optional(v.string()),
    activeRunMode: v.optional(
      v.union(
        v.literal("spec"),
        v.literal("implement"),
        v.literal("review"),
        v.literal("fix"),
      ),
    ),
    dispatchedAt: v.optional(v.number()),
    lastCallbackAt: v.optional(v.number()),
    lastError: v.optional(v.string()),

    createdAt: v.number(),
    updatedAt: v.number(),

    ...extraBugFields,
  })
    .index("by_status", ["status"])
    .index("by_originator", ["originatorUserId"])
    .index("by_routineRunId", ["routineRunId"])
    .index("by_mergeCommitSha", ["mergeCommitSha"]);

  for (const idx of extraBugIndexes) {
    devBugs = devBugs.index(idx.name, idx.fields as any);
  }

  const devBugMessages = defineTable({
    bugId: v.id("devBugs"),
    authorType: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    userId: v.optional(v.id("users")),
    body: v.string(),
    imageUrls: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index("by_bug", ["bugId", "createdAt"]);

  return { devBugs, devBugMessages };
}
