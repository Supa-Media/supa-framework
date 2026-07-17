/**
 * Dev-Assistant bug DB operations — the pipeline row lifecycle, the signed
 * callback applier, and the GitHub webhook handlers. Ported faithfully from
 * Togather's `apps/convex/functions/devAssistant/bugs.ts` (ADR-029), with the
 * app-specific bits routed through config/refs/notifier:
 *  - `internal.functions.devAssistant.*` → `refs.*`
 *  - push / chat side effects → `cfg.notifier` events (see `../notifier`)
 *  - `getMediaUrl` → `cfg.resolveMediaUrl`
 *  - staff gate → `cfg.isSuperAdmin`
 *  - repo slug / workflow names / branch prefix → `cfg.repo`
 *
 * Built with Convex's `*Generic` builders so the package needs no generated
 * types from the host app.
 */

import {
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import type { ResolvedDevAssistantConfig } from "../config";
import type { DevAssistantRefs } from "./refs";
import { applyStatusTransition, insertThreadMessage } from "./dbHelpers";
import {
  BUG_STATUSES,
  canTransition,
  GITHUB_MERGEABLE_STATUSES,
  RISK_LEVELS,
  SCOPES,
  REVIEW_VERDICTS,
  CALLBACK_SOURCES,
  type BugStatus,
} from "../pipeline/statusMachine";
import { checkCallbackPolicy, shouldIgnoreVerdict } from "../pipeline/callbackPolicy";
import { bugIdFromBranchRef } from "../pipeline/github";
import {
  MERGED_DEPLOYING_MESSAGE,
  STAGING_LIVE_MESSAGE,
  PR_CLOSED_UNMERGED_MESSAGE,
  STATUS_SYSTEM_MESSAGES,
  REVIEW_SUMMARY_THREAD_LIMIT,
  fixRoundsExhaustedMessage,
} from "../pipeline/text";

// ---- Validators (mirror the pipeline enums as Convex validators) ----
// NOTE: these MUST keep concrete validator types (no `as any`) — the erased
// type would flow into the functions' `args` and collapse them to
// `RegisteredMutation<…, any, …>`, which drops the arg types from the
// consumer's generated `api`/`internal` surface. See the type-level
// regression test in `test/apiTypes.test-d.ts`.
export const bugStatusValidator = v.union(
  ...BUG_STATUSES.map((s) => v.literal(s)),
);
export const riskLevelValidator = v.union(
  ...RISK_LEVELS.map((s) => v.literal(s)),
);
export const scopeValidator = v.union(...SCOPES.map((s) => v.literal(s)));
export const reviewVerdictValidator = v.union(
  ...REVIEW_VERDICTS.map((s) => v.literal(s)),
);
export const callbackSourceValidator = v.union(
  ...CALLBACK_SOURCES.map((s) => v.literal(s)),
);
export const splitSlicesValidator = v.array(
  v.object({ title: v.string(), prompt: v.string() }),
);

const FAILED_WORKFLOW_CONCLUSIONS = [
  "failure",
  "cancelled",
  "timed_out",
  "startup_failure",
];

export function makeBugsFunctions(
  cfg: ResolvedDevAssistantConfig,
  refs: DevAssistantRefs,
) {
  const MAX_FIX_ROUNDS = cfg.maxFixRounds;

  // ==========================================================================
  // Conversation thread
  // ==========================================================================

  const getThreadHistory = internalQueryGeneric({
    args: { bugId: v.id("devBugs") },
    handler: async (ctx: any, args): Promise<any[]> => {
      const messages = await ctx.db
        .query("devBugMessages")
        .withIndex("by_bug", (q: any) => q.eq("bugId", args.bugId))
        .order("asc")
        .collect();
      const entries: any[] = [];
      for (const m of messages) {
        let authorName: string | undefined;
        if (m.authorType === "user" && m.userId) {
          const user = await ctx.db.get(m.userId);
          authorName = user
            ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || undefined
            : undefined;
        }
        entries.push({
          authorType: m.authorType,
          authorName,
          body: m.body,
          ...(m.imageUrls && m.imageUrls.length > 0
            ? { imageUrls: m.imageUrls }
            : {}),
        });
      }
      return entries;
    },
  });

  // ==========================================================================
  // Reads
  // ==========================================================================

  const getBug = internalQueryGeneric({
    args: { bugId: v.id("devBugs") },
    handler: async (ctx: any, args) => await ctx.db.get(args.bugId),
  });

  const getBugByRoutineRunId = internalQueryGeneric({
    args: { routineRunId: v.string() },
    handler: async (ctx: any, args) =>
      await ctx.db
        .query("devBugs")
        .withIndex("by_routineRunId", (q: any) =>
          q.eq("routineRunId", args.routineRunId),
        )
        .first(),
  });

  const getOriginatorAttribution = internalQueryGeneric({
    args: { bugId: v.id("devBugs") },
    handler: async (ctx: any, args) => {
      const bug = await ctx.db.get(args.bugId);
      if (!bug) return null;
      const user = await ctx.db.get(bug.originatorUserId);
      if (!user) return null;
      const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
      return {
        name: name || undefined,
        githubUsername: user.githubUsername || undefined,
      };
    },
  });

  /** Bugs whose PR is open (CODE_REVIEW / READY_TO_MERGE) and has a prUrl. */
  const listOpenPrBugs = internalQueryGeneric({
    args: {},
    handler: async (ctx: any): Promise<any[]> => {
      const out: any[] = [];
      for (const status of ["CODE_REVIEW", "READY_TO_MERGE"] as const) {
        const rows = await ctx.db
          .query("devBugs")
          .withIndex("by_status", (q: any) => q.eq("status", status))
          .collect();
        for (const b of rows) if (b.prUrl) out.push(b);
      }
      return out;
    },
  });

  // ==========================================================================
  // Dispatch-side stamping
  // ==========================================================================

  const markDispatched = internalMutationGeneric({
    args: { bugId: v.id("devBugs"), routineRunId: v.string() },
    handler: async (ctx: any, args) => {
      const bug = await ctx.db.get(args.bugId);
      if (!bug) return { alreadyDispatched: true };
      if (bug.status !== "READY_FOR_IMPL") return { alreadyDispatched: true };
      await ctx.db.patch(args.bugId, {
        status: "IN_PROGRESS",
        routineRunId: args.routineRunId,
        activeRunMode: "implement",
        dispatchedAt: Date.now(),
        lastError: undefined,
        updatedAt: Date.now(),
      });
      return { alreadyDispatched: false };
    },
  });

  const markSpecDispatched = internalMutationGeneric({
    args: {
      bugId: v.id("devBugs"),
      routineRunId: v.string(),
      revision: v.optional(v.boolean()),
    },
    handler: async (ctx: any, args) => {
      const bug = await ctx.db.get(args.bugId);
      if (!bug) return { alreadyDispatched: true };
      if (args.revision) {
        if (bug.status !== "DRAFT" && bug.status !== "IN_REVIEW") {
          return { alreadyDispatched: true };
        }
      } else if (bug.status !== "DRAFT" || bug.routineRunId) {
        return { alreadyDispatched: true };
      }
      await ctx.db.patch(args.bugId, {
        routineRunId: args.routineRunId,
        activeRunMode: "spec",
        lastError: undefined,
        updatedAt: Date.now(),
      });
      return { alreadyDispatched: false };
    },
  });

  const markReviewDispatched = internalMutationGeneric({
    args: { bugId: v.id("devBugs"), routineRunId: v.string() },
    handler: async (ctx: any, args) => {
      const bug = await ctx.db.get(args.bugId);
      if (!bug) return { alreadyDispatched: true };
      if (bug.status !== "CODE_REVIEW") return { alreadyDispatched: true };
      await ctx.db.patch(args.bugId, {
        routineRunId: args.routineRunId,
        activeRunMode: "review",
        lastError: undefined,
        updatedAt: Date.now(),
      });
      return { alreadyDispatched: false };
    },
  });

  const markFixDispatched = internalMutationGeneric({
    args: { bugId: v.id("devBugs"), routineRunId: v.string() },
    handler: async (ctx: any, args) => {
      const bug = await ctx.db.get(args.bugId);
      if (!bug || bug.status !== "CODE_REVIEW") {
        return { alreadyDispatched: true };
      }
      const fixRound = (bug.fixRounds ?? 0) + 1;
      await ctx.db.patch(args.bugId, {
        routineRunId: args.routineRunId,
        activeRunMode: "fix",
        fixRounds: fixRound,
        lastError: undefined,
        updatedAt: Date.now(),
      });
      await insertThreadMessage(
        ctx,
        args.bugId,
        "system",
        `AI is addressing the review feedback (round ${fixRound} of ${MAX_FIX_ROUNDS})`,
      );
      return { alreadyDispatched: false };
    },
  });

  const setGithubIssue = internalMutationGeneric({
    args: {
      bugId: v.id("devBugs"),
      githubIssueNumber: v.number(),
      githubIssueUrl: v.optional(v.string()),
    },
    handler: async (ctx: any, args) => {
      await ctx.db.patch(args.bugId, {
        githubIssueNumber: args.githubIssueNumber,
        githubIssueUrl: args.githubIssueUrl,
        updatedAt: Date.now(),
      });
    },
  });

  const recordDispatchError = internalMutationGeneric({
    args: { bugId: v.id("devBugs"), error: v.string() },
    handler: async (ctx: any, args) => {
      await ctx.db.patch(args.bugId, {
        lastError: args.error,
        updatedAt: Date.now(),
      });
    },
  });

  const addSystemThreadMessage = internalMutationGeneric({
    args: { bugId: v.id("devBugs"), body: v.string() },
    handler: async (ctx: any, args) => {
      const bug = await ctx.db.get(args.bugId);
      if (!bug) return;
      await insertThreadMessage(ctx, args.bugId, "system", args.body);
      await ctx.db.patch(args.bugId, { updatedAt: Date.now() });
    },
  });

  const recordProductionDeployOutcome = internalMutationGeneric({
    args: {
      bugId: v.id("devBugs"),
      ok: v.boolean(),
      detail: v.optional(v.string()),
    },
    handler: async (ctx: any, args) => {
      const bug = await ctx.db.get(args.bugId);
      if (!bug) return;
      if (args.ok) {
        await insertThreadMessage(
          ctx,
          args.bugId,
          "system",
          "Deploying to production…",
        );
        const now = Date.now();
        await ctx.db.patch(args.bugId, {
          productionDeploy: { state: "pending", requestedAt: now, updatedAt: now },
          updatedAt: now,
        });
      } else {
        await insertThreadMessage(
          ctx,
          args.bugId,
          "system",
          `Production deploy couldn't start${args.detail ? `: ${args.detail}` : ""} — needs a maintainer`,
        );
        await ctx.db.patch(args.bugId, {
          productionRequestedAt: undefined,
          updatedAt: Date.now(),
        });
      }
    },
  });

  const recordMergeFromAppFailure = internalMutationGeneric({
    args: { bugId: v.id("devBugs"), reason: v.string() },
    handler: async (ctx: any, args) => {
      const bug = await ctx.db.get(args.bugId);
      if (!bug) return;
      await insertThreadMessage(ctx, args.bugId, "system", args.reason);
      await ctx.db.patch(args.bugId, {
        mergeRequestedAt: undefined,
        updatedAt: Date.now(),
      });
    },
  });

  // ==========================================================================
  // applyCallback — the signed-callback / webhook / auto-merge applier
  // ==========================================================================

  const applyCallback = internalMutationGeneric({
    args: {
      bugId: v.id("devBugs"),
      status: bugStatusValidator,
      source: v.optional(callbackSourceValidator),
      mergeCommitSha: v.optional(v.string()),
      prUrl: v.optional(v.string()),
      screenshots: v.optional(v.array(v.string())),
      spec: v.optional(v.string()),
      riskLevel: v.optional(riskLevelValidator),
      aiTitle: v.optional(v.string()),
      area: v.optional(v.string()),
      scope: v.optional(scopeValidator),
      splitSlices: v.optional(splitSlicesValidator),
      verifyOnStaging: v.optional(v.boolean()),
      reviewVerdict: v.optional(reviewVerdictValidator),
      reviewSummary: v.optional(v.string()),
    },
    handler: async (ctx: any, args) => {
      const bug = await ctx.db.get(args.bugId);
      if (!bug) return null;

      const source = args.source ?? "routine";
      const mode = bug.activeRunMode as
        | "spec"
        | "implement"
        | "review"
        | "fix"
        | undefined;
      const now = Date.now();

      const reject = async (reason: string) => {
        await ctx.db.patch(args.bugId, { lastError: reason, updatedAt: now });
        return await ctx.db.get(args.bugId);
      };

      // MERGED is webhook/auto-merge-only: GitHub is ground truth for merges.
      if (args.status === "MERGED" && source === "routine") {
        return await reject(
          "Rejected callback: MERGED is applied only from the GitHub webhook or auto-merge",
        );
      }

      // Per-run-mode policy (pure — see callbackPolicy).
      const policyError = checkCallbackPolicy({
        source,
        mode,
        status: args.status,
        reviewVerdict: args.reviewVerdict,
      });
      if (policyError) return await reject(`Rejected callback: ${policyError}`);

      const ignoreVerdict = shouldIgnoreVerdict(source, mode);
      const reviewVerdict = ignoreVerdict ? undefined : args.reviewVerdict;
      const reviewSummary = ignoreVerdict ? undefined : args.reviewSummary;

      const targetStatus: BugStatus =
        reviewVerdict === "approved" && args.status === "CODE_REVIEW"
          ? "READY_TO_MERGE"
          : args.status;

      const transitionOk =
        targetStatus === "MERGED" && source !== "routine"
          ? GITHUB_MERGEABLE_STATUSES.includes(bug.status)
          : canTransition(bug.status, targetStatus);
      if (!transitionOk) {
        return await reject(
          `Ignored callback transition ${bug.status} -> ${targetStatus}`,
        );
      }
      const genuineTransition = targetStatus !== bug.status;

      const patch: any = {
        status: targetStatus,
        lastError: undefined,
        lastCallbackAt: now,
        updatedAt: now,
      };
      if (args.prUrl !== undefined) patch.prUrl = args.prUrl;
      if (args.screenshots !== undefined) patch.planPreviewUrls = args.screenshots;
      if (args.spec !== undefined) patch.spec = args.spec;
      if (args.riskLevel !== undefined) patch.riskLevel = args.riskLevel;
      if (args.aiTitle !== undefined) patch.aiTitle = args.aiTitle;
      if (args.area !== undefined) patch.area = args.area;
      if (args.scope !== undefined) patch.scope = args.scope;
      if (args.splitSlices !== undefined) {
        patch.splitSlices = args.splitSlices;
      } else if (args.scope !== undefined && args.scope !== "split") {
        patch.splitSlices = undefined;
      }
      if (args.verifyOnStaging !== undefined) {
        patch.verifyOnStaging = args.verifyOnStaging;
      }
      if (targetStatus === "MERGED" && !bug.shippedAt) patch.shippedAt = now;
      if (targetStatus === "MERGED" && genuineTransition) {
        if (args.mergeCommitSha !== undefined) {
          patch.mergeCommitSha = args.mergeCommitSha;
        }
        patch.stagingDeploy = { state: "pending", workflows: [], updatedAt: now };
        patch.mergeRequestedAt = undefined;
      }

      const specChanged = args.spec !== undefined && args.spec !== bug.spec;
      if (specChanged && bug.specApprovedAt) patch.specApprovedAt = undefined;

      const enteredCodeReview =
        genuineTransition && targetStatus === "CODE_REVIEW";
      if (enteredCodeReview) {
        patch.reviewVerdict = undefined;
        patch.reviewSummary = undefined;
        await ctx.scheduler.runAfter(0, refs.actions.dispatchReview, {
          bugId: args.bugId,
        });
      }

      const fixesPushed =
        !enteredCodeReview &&
        args.status === "CODE_REVIEW" &&
        bug.status === "CODE_REVIEW" &&
        bug.reviewVerdict === "changes_requested" &&
        (mode === "fix" ||
          (mode === undefined && args.reviewVerdict === undefined));
      if (fixesPushed) {
        patch.reviewVerdict = undefined;
        patch.reviewSummary = undefined;
        await ctx.scheduler.runAfter(0, refs.actions.dispatchReview, {
          bugId: args.bugId,
        });
      }

      if (reviewVerdict !== undefined) patch.reviewVerdict = reviewVerdict;
      if (reviewSummary !== undefined) patch.reviewSummary = reviewSummary;

      await ctx.db.patch(args.bugId, patch);

      if (fixesPushed) {
        await insertThreadMessage(
          ctx,
          args.bugId,
          "system",
          "Fixes pushed — running code review again",
        );
      }

      // Delivered spec → a short pointer (never the full plan text).
      if (args.spec !== undefined && args.spec !== bug.spec) {
        const pointer =
          bug.spec === undefined
            ? 'The plan is ready — read it under "The plan" below'
            : bug.specApprovedAt
              ? "Plan updated — it needs your approval again"
              : 'Plan updated — the latest version is under "The plan" below';
        await insertThreadMessage(ctx, args.bugId, "system", pointer);
      }

      // Review verdict → a system turn, before the status progress line.
      if (
        reviewVerdict !== undefined &&
        (reviewVerdict !== bug.reviewVerdict ||
          (reviewSummary !== undefined && reviewSummary !== bug.reviewSummary))
      ) {
        let message: string;
        if (reviewVerdict === "approved") {
          message = "Code review passed ✓";
        } else {
          const summary = reviewSummary?.trim();
          const quoted =
            summary && summary.length > REVIEW_SUMMARY_THREAD_LIMIT
              ? `${summary.slice(0, REVIEW_SUMMARY_THREAD_LIMIT)}…`
              : summary;
          message = quoted
            ? `Code review requested changes — ${quoted}`
            : "Code review requested changes";
        }
        await insertThreadMessage(ctx, args.bugId, "system", message);
      }

      // Review → fix → re-review loop (Phase 3).
      const verdictBecameChangesRequested =
        reviewVerdict === "changes_requested" &&
        bug.reviewVerdict !== "changes_requested" &&
        targetStatus === "CODE_REVIEW";
      if (verdictBecameChangesRequested) {
        if ((bug.fixRounds ?? 0) < MAX_FIX_ROUNDS) {
          await ctx.scheduler.runAfter(0, refs.actions.dispatchFix, {
            bugId: args.bugId,
          });
        } else {
          await insertThreadMessage(
            ctx,
            args.bugId,
            "system",
            fixRoundsExhaustedMessage(MAX_FIX_ROUNDS),
          );
          await cfg.notifier.notify(ctx, {
            type: "fixRoundsExhausted",
            bug: { ...bug, ...patch },
          });
        }
      }

      // Policy auto-merge (Phase 3): a genuine entry into READY_TO_MERGE.
      if (genuineTransition && targetStatus === "READY_TO_MERGE") {
        await ctx.scheduler.runAfter(0, refs.actions.attemptAutoMerge, {
          bugId: args.bugId,
        });
      }

      // Progress log (only on a genuine status change).
      if (genuineTransition) {
        const systemMessage = STATUS_SYSTEM_MESSAGES[targetStatus];
        if (systemMessage) {
          await insertThreadMessage(ctx, args.bugId, "system", systemMessage);
        }
      }

      return await ctx.db.get(args.bugId);
    },
  });

  // ==========================================================================
  // GitHub webhooks: pull_request closed + workflow_run
  // ==========================================================================

  const handleGithubPrClosed = internalMutationGeneric({
    args: {
      branchRef: v.string(),
      prUrl: v.optional(v.string()),
      merged: v.boolean(),
      mergeCommitSha: v.optional(v.string()),
    },
    handler: async (ctx: any, args) => {
      let bug: any = null;
      const parsedBugId = bugIdFromBranchRef(cfg.repo, args.branchRef);
      if (parsedBugId) {
        const bugId = ctx.db.normalizeId("devBugs", parsedBugId);
        if (bugId) bug = await ctx.db.get(bugId);
      }
      if (!bug && args.prUrl) {
        for (const status of ["CODE_REVIEW", "READY_TO_MERGE"] as const) {
          const candidates = await ctx.db
            .query("devBugs")
            .withIndex("by_status", (q: any) => q.eq("status", status))
            .collect();
          bug = candidates.find((b: any) => b.prUrl === args.prUrl) ?? null;
          if (bug) break;
        }
      }
      if (!bug) {
        console.log(
          "[DevAssistant] GitHub PR-closed webhook did not correlate to a devBug",
          args.branchRef,
          args.prUrl,
        );
        return;
      }
      const target = bug;

      if (args.merged) {
        if (target.status === "MERGED") return;
        if (args.prUrl) {
          const staleForCurrentRound = target.prUrl
            ? target.prUrl !== args.prUrl
            : !!target.shippedAt;
          if (staleForCurrentRound) {
            console.log(
              "[DevAssistant] Ignoring stale PR-merged event for a previous round",
              target._id,
              args.prUrl,
            );
            return;
          }
        }
        if (target.routineRunId) {
          await ctx.scheduler.runAfter(0, refs.actions.handleRoutineCallback, {
            bugId: target._id,
            routineRunId: target.routineRunId,
            status: "MERGED",
            source: "webhook",
            mergeCommitSha: args.mergeCommitSha,
          });
        } else if (GITHUB_MERGEABLE_STATUSES.includes(target.status)) {
          const now = Date.now();
          await ctx.db.patch(target._id, {
            status: "MERGED",
            ...(target.shippedAt ? {} : { shippedAt: now }),
            ...(args.mergeCommitSha
              ? { mergeCommitSha: args.mergeCommitSha }
              : {}),
            stagingDeploy: { state: "pending", workflows: [], updatedAt: now },
            updatedAt: now,
          });
          await insertThreadMessage(
            ctx,
            target._id,
            "system",
            MERGED_DEPLOYING_MESSAGE,
          );
        } else {
          console.error(
            "[DevAssistant] GitHub merge webhook ignored: bug in status",
            target.status,
          );
        }
        return;
      }

      // Closed without merging: needs a human.
      const last = await ctx.db
        .query("devBugMessages")
        .withIndex("by_bug", (q: any) => q.eq("bugId", target._id))
        .order("desc")
        .first();
      if (last?.body !== PR_CLOSED_UNMERGED_MESSAGE) {
        await insertThreadMessage(
          ctx,
          target._id,
          "system",
          PR_CLOSED_UNMERGED_MESSAGE,
        );
        await ctx.db.patch(target._id, { updatedAt: Date.now() });
      }
    },
  });

  const handleWorkflowRunEvent = internalMutationGeneric({
    args: {
      action: v.string(),
      name: v.string(),
      status: v.optional(v.string()),
      conclusion: v.optional(v.string()),
      headSha: v.string(),
      headBranch: v.optional(v.string()),
      runStartedAt: v.optional(v.number()),
    },
    handler: async (ctx: any, args) => {
      const now = Date.now();

      // ---- Production runs: global, correlated by state (not SHA) ----
      if (args.name === cfg.repo.productionDeployWorkflowName) {
        if (args.action !== "completed") return;
        const succeeded = args.conclusion === "success";
        const failed =
          !!args.conclusion &&
          FAILED_WORKFLOW_CONCLUSIONS.includes(args.conclusion);
        if (!succeeded && !failed) return;

        const merged = await ctx.db
          .query("devBugs")
          .withIndex("by_status", (q: any) => q.eq("status", "MERGED"))
          .collect();
        for (const bug of merged) {
          if (bug.productionDeploy?.state !== "pending") continue;
          const requestedAt = bug.productionDeploy.requestedAt;
          if (
            args.runStartedAt !== undefined &&
            requestedAt !== undefined &&
            requestedAt > args.runStartedAt
          ) {
            continue;
          }
          if (succeeded) {
            await ctx.db.patch(bug._id, {
              productionDeploy: { state: "live", updatedAt: now },
              updatedAt: now,
            });
            await insertThreadMessage(ctx, bug._id, "system", "Live in production 🎉");
          } else {
            await ctx.db.patch(bug._id, {
              productionDeploy: {
                state: "failed",
                failedWorkflow: args.name,
                updatedAt: now,
              },
              updatedAt: now,
            });
            await insertThreadMessage(
              ctx,
              bug._id,
              "system",
              "Production deploy failed — contact the lead maintainer.",
            );
          }
        }
        return;
      }

      // ---- Staging runs: correlated by merge commit SHA ----
      if (
        args.headBranch !== cfg.repo.baseBranch ||
        !cfg.repo.stagingDeployWorkflowNames.includes(args.name)
      ) {
        return;
      }

      const candidates = await ctx.db
        .query("devBugs")
        .withIndex("by_mergeCommitSha", (q: any) =>
          q.eq("mergeCommitSha", args.headSha),
        )
        .collect();

      for (const bug of candidates) {
        if (bug.stagingDeploy?.state !== "pending") continue;
        const workflows: any[] = [...(bug.stagingDeploy.workflows ?? [])];

        let entry = workflows.find((w) => w.name === args.name);
        if (!entry) {
          entry = { name: args.name };
          workflows.push(entry);
        }

        if (args.action !== "completed") {
          await ctx.db.patch(bug._id, {
            stagingDeploy: { ...bug.stagingDeploy, workflows, updatedAt: now },
            updatedAt: now,
          });
          continue;
        }

        entry.conclusion = args.conclusion;
        const failed =
          !!args.conclusion &&
          FAILED_WORKFLOW_CONCLUSIONS.includes(args.conclusion);
        if (failed) {
          await ctx.db.patch(bug._id, {
            stagingDeploy: {
              state: "failed",
              workflows,
              failedWorkflow: args.name,
              updatedAt: now,
            },
            updatedAt: now,
          });
          await insertThreadMessage(
            ctx,
            bug._id,
            "system",
            `Staging deploy failed (${args.name}) — contact the lead maintainer.`,
          );
          continue;
        }

        const allSucceeded =
          workflows.length > 0 &&
          workflows.every((w) => w.conclusion === "success");
        if (!allSucceeded) {
          await ctx.db.patch(bug._id, {
            stagingDeploy: { ...bug.stagingDeploy, workflows, updatedAt: now },
            updatedAt: now,
          });
          continue;
        }

        await ctx.db.patch(bug._id, {
          stagingDeploy: { state: "live", workflows, updatedAt: now },
          updatedAt: now,
        });
        await insertThreadMessage(ctx, bug._id, "system", STAGING_LIVE_MESSAGE);

        // The change is actually up now — fire the "try it on staging" notice.
        await cfg.notifier.notify(ctx, { type: "stagingLive", bug });
      }
    },
  });

  // ==========================================================================
  // Maintainer review-screen ops (staff-gated via cfg.isSuperAdmin)
  // ==========================================================================

  const requireSuperAdmin = async (ctx: any, token: string): Promise<string> => {
    const userId = await cfg.authenticate(ctx, token);
    if (!(await cfg.isSuperAdmin(ctx, userId))) {
      throw new Error("Superuser access required");
    }
    return userId;
  };

  const getBugForReview = queryGeneric({
    args: { token: v.string(), bugId: v.id("devBugs") },
    handler: async (ctx: any, args) => {
      await requireSuperAdmin(ctx, args.token);
      const bug = await ctx.db.get(args.bugId);
      if (!bug) return null;
      const originator = await ctx.db.get(bug.originatorUserId);
      return {
        ...bug,
        originatorName: originator
          ? `${originator.firstName ?? ""} ${originator.lastName ?? ""}`.trim()
          : "Unknown",
      };
    },
  });

  const rejectBug = mutationGeneric({
    args: { token: v.string(), bugId: v.id("devBugs") },
    handler: async (ctx: any, args) => {
      await requireSuperAdmin(ctx, args.token);
      const bug = await ctx.db.get(args.bugId);
      if (!bug) throw new Error("Bug not found");
      await applyStatusTransition(ctx, bug, "REJECTED", refs);
      await ctx.db.patch(args.bugId, {
        routineRunId: undefined,
        activeRunMode: undefined,
      });
      return { ok: true };
    },
  });

  const markBugMerged = mutationGeneric({
    args: { token: v.string(), bugId: v.id("devBugs") },
    handler: async (ctx: any, args) => {
      await requireSuperAdmin(ctx, args.token);
      const bug = await ctx.db.get(args.bugId);
      if (!bug) throw new Error("Bug not found");
      await applyStatusTransition(ctx, bug, "MERGED", refs);
      return { ok: true };
    },
  });

  const retryDispatch = mutationGeneric({
    args: { token: v.string(), bugId: v.id("devBugs") },
    handler: async (ctx: any, args) => {
      await requireSuperAdmin(ctx, args.token);
      const bug = await ctx.db.get(args.bugId);
      if (!bug) throw new Error("Bug not found");
      if (bug.status !== "IN_PROGRESS" && bug.status !== "READY_FOR_IMPL") {
        throw new Error(`Cannot retry dispatch from status ${bug.status}`);
      }
      await ctx.scheduler.runAfter(0, refs.actions.dispatchBug, {
        bugId: bug._id,
        forceRedispatch: true,
      });
      return { ok: true };
    },
  });

  return {
    getThreadHistory,
    getBug,
    getBugByRoutineRunId,
    getOriginatorAttribution,
    listOpenPrBugs,
    markDispatched,
    markSpecDispatched,
    markReviewDispatched,
    markFixDispatched,
    setGithubIssue,
    recordDispatchError,
    addSystemThreadMessage,
    recordProductionDeployOutcome,
    recordMergeFromAppFailure,
    applyCallback,
    handleGithubPrClosed,
    handleWorkflowRunEvent,
    getBugForReview,
    rejectBug,
    markBugMerged,
    retryDispatch,
  };
}
