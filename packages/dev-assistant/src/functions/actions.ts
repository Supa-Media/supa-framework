/**
 * Dev-Assistant actions — Routine dispatch (spec/implement/review/fix), policy
 * auto-merge, the in-app merge button, the reconcile backstop, the production
 * deploy trigger, and the signed-callback handler. Ported faithfully from
 * Togather's `apps/convex/functions/devAssistant/actions.ts` (ADR-029).
 *
 * The Togather chat-mention entry point (`processThreadMention` + the OpenAI
 * agent loop) is NOT part of this package — it is chat-plumbing specific to
 * Togather and stays in the app. Everything else generalizes; app-specific bits
 * route through `cfg`/`refs`/`notifier`.
 *
 * Every function is a MODULE-LEVEL const built directly with `internalActionGeneric`
 * (NOT returned from a factory) so a consumer's generated `internal` types
 * survive (see `../holder`). Config/refs are read LAZILY inside each handler.
 */

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { getDevAssistantConfig, getDevAssistantRefs } from "../holder";
import {
  bugStatusValidator,
  callbackSourceValidator,
  reviewVerdictValidator,
  riskLevelValidator,
  scopeValidator,
  splitSlicesValidator,
} from "./bugs";
import { isWithinAutoMergeCap } from "../pipeline/severity";
import {
  branchRefForBug,
  buildGithubIssueBody,
  fetchPrMerged,
  githubErrorDetail,
  githubJsonHeaders,
  isMergeableState,
  issuesEndpoint,
  mergePullRequestOnGithub,
  mergeRecoveryPollDelayMs,
  prNumberFromUrl,
  readMergeCommitSha,
  updatePullRequestBranch,
  workflowDispatchEndpoint,
} from "../pipeline/github";
import {
  MERGE_BEHIND_RECOVERING_MESSAGE,
  MERGE_RECOVERY_MAX_POLLS,
  defaultCallbackMessage,
  describeMergeBlock,
} from "../pipeline/text";

/**
 * Per-mode Routine trigger credentials (spec / implement / review run as
 * separate Routines with least-privilege credentials — see the ROUTINE-PROMPT
 * template), falling back to the legacy single CLAUDE_ROUTINES_TRIGGER_URL/TOKEN
 * so a one-Routine setup keeps working. Env var names identical to Togather.
 */
function routineTrigger(mode: "spec" | "implement" | "review"): {
  triggerUrl: string | undefined;
  token: string | undefined;
} {
  const perMode =
    mode === "spec"
      ? {
          triggerUrl: process.env.CLAUDE_ROUTINES_TRIGGER_URL_SPEC,
          token: process.env.CLAUDE_ROUTINES_TOKEN_SPEC,
        }
      : mode === "implement"
        ? {
            triggerUrl: process.env.CLAUDE_ROUTINES_TRIGGER_URL_IMPL,
            token: process.env.CLAUDE_ROUTINES_TOKEN_IMPL,
          }
        : {
            triggerUrl: process.env.CLAUDE_ROUTINES_TRIGGER_URL_REVIEW,
            token: process.env.CLAUDE_ROUTINES_TOKEN_REVIEW,
          };
  return {
    triggerUrl: perMode.triggerUrl ?? process.env.CLAUDE_ROUTINES_TRIGGER_URL,
    token: perMode.token ?? process.env.CLAUDE_ROUTINES_TOKEN,
  };
}

/**
 * GitHub PAT for issue mirroring and Phase 3 auto-merge. `GH_MIRROR_TOKEN`;
 * `GITHUB_MIRROR_TOKEN` is the legacy fallback (env names identical to Togather).
 */
function githubMirrorToken(): string | undefined {
  return process.env.GH_MIRROR_TOKEN ?? process.env.GITHUB_MIRROR_TOKEN;
}

function callbackUrl(): string {
  return `${process.env.CONVEX_SITE_URL}/dev-assistant/callback`;
}

/** POST the per-invocation payload as the Routine's triggering message. */
async function fireRoutine(
  triggerUrl: string,
  token: string,
  payload: unknown,
): Promise<Response> {
  return await fetch(triggerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Required on every api.anthropic.com endpoint, including the routine
      // fire endpoint — without it the gateway rejects with 400.
      "anthropic-version": "2023-06-01",
    },
    // The fire endpoint reads the payload from `text` and ignores other
    // top-level fields, so the payload is JSON-stringified into `text`.
    body: JSON.stringify({ text: JSON.stringify(payload) }),
  });
}

/** Resolve stored media paths to fetchable URLs via the configured resolver. */
function resolveShots(urls: string[] | undefined): string[] {
  const cfg = getDevAssistantConfig();
  return (urls ?? [])
    .map((u) => cfg.resolveMediaUrl(u))
    .filter((u): u is string => !!u);
}

// Shared: apply MERGED through the trusted "automerge" source after GitHub
// confirmed a merge (routes through handleRoutineCallback so the notifier
// fires; rows with no run fall back to a direct applyCallback).
async function applyGithubConfirmedMerge(
  ctx: any,
  bug: { _id: string; routineRunId?: string },
  mergeCommitSha?: string,
): Promise<void> {
  const refs = getDevAssistantRefs();
  if (bug.routineRunId) {
    await ctx.runAction(refs.actions.handleRoutineCallback, {
      bugId: bug._id,
      routineRunId: bug.routineRunId,
      status: "MERGED",
      source: "automerge",
      mergeCommitSha,
    });
  } else {
    await ctx.runMutation(refs.bugs.applyCallback, {
      bugId: bug._id,
      status: "MERGED",
      source: "automerge",
      mergeCommitSha,
    });
  }
}

// ==========================================================================
// dispatchBug (implement / staging-redo)
// ==========================================================================

export const dispatchBug = internalActionGeneric({
  args: { bugId: v.id("devBugs"), forceRedispatch: v.optional(v.boolean()) },
  handler: async (ctx: any, args): Promise<void> => {
    const cfg = getDevAssistantConfig();
    const refs = getDevAssistantRefs();
    const bug = await ctx.runQuery(refs.bugs.getBug, { bugId: args.bugId });
    if (!bug) return;

    const stagingRedo = (bug.redoRounds ?? 0) > 0;

    const { triggerUrl, token } = routineTrigger("implement");
    if (!triggerUrl || !token) {
      console.error("[DevAssistant] CLAUDE_ROUTINES_* env not configured");
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: "Routine trigger env not configured",
      });
      return;
    }

    let routineRunId = bug.routineRunId;
    if (!args.forceRedispatch || !routineRunId) {
      routineRunId = routineRunId ?? crypto.randomUUID();
      const marked = await ctx.runMutation(refs.bugs.markDispatched, {
        bugId: args.bugId,
        routineRunId,
      });
      if (marked.alreadyDispatched && !args.forceRedispatch) return;
    }

    // GitHub issue mirroring (Phase 2) — best-effort, non-fatal.
    let githubIssueNumber = bug.githubIssueNumber;
    const mirrorToken = githubMirrorToken();
    if (mirrorToken && githubIssueNumber === undefined) {
      try {
        const res = await fetch(issuesEndpoint(cfg.repo), {
          method: "POST",
          headers: githubJsonHeaders(mirrorToken),
          body: JSON.stringify({
            title: bug.aiTitle ?? bug.title,
            body: buildGithubIssueBody(cfg.repo, bug),
          }),
        });
        if (!res.ok) {
          throw new Error(`GitHub issue POST ${res.status}: ${await res.text()}`);
        }
        const issue = (await res.json()) as { number?: number; html_url?: string };
        if (typeof issue.number !== "number") {
          throw new Error("GitHub issue response missing `number`");
        }
        githubIssueNumber = issue.number;
        await ctx.runMutation(refs.bugs.setGithubIssue, {
          bugId: args.bugId,
          githubIssueNumber: issue.number,
          githubIssueUrl:
            typeof issue.html_url === "string" ? issue.html_url : undefined,
        });
      } catch (error) {
        console.error("[DevAssistant] GitHub issue mirroring failed:", error);
        await ctx.runMutation(refs.bugs.recordDispatchError, {
          bugId: args.bugId,
          error: `GitHub issue mirroring failed (non-fatal): ${String(error)}`,
        });
      }
    }

    const originator = await ctx.runQuery(refs.bugs.getOriginatorAttribution, {
      bugId: args.bugId,
    });

    const thread = stagingRedo
      ? await ctx.runQuery(refs.bugs.getThreadHistory, { bugId: args.bugId })
      : null;

    const redoShots = stagingRedo
      ? resolveShots(
          Array.from(
            new Set([
              ...(bug.screenshotUrls ?? []),
              ...(thread ?? []).flatMap((m: any) => m.imageUrls ?? []),
            ]),
          ),
        )
      : null;
    const reportShots = resolveShots(bug.screenshotUrls);

    const payload = {
      bugId: args.bugId,
      routineRunId,
      title: bug.title,
      body: bug.body,
      repro: bug.repro,
      screenshotUrls:
        redoShots && redoShots.length > 0
          ? redoShots
          : reportShots.length > 0
            ? reportShots
            : undefined,
      spec: bug.spec,
      riskLevel: bug.riskLevel,
      githubIssueNumber,
      originatorName: originator?.name,
      originatorGithubUsername: originator?.githubUsername,
      branch: branchRefForBug(cfg.repo, String(args.bugId)),
      baseBranch: cfg.repo.baseBranch,
      callbackUrl: callbackUrl(),
      ...(stagingRedo && thread
        ? {
            redo: true,
            thread: thread.map((m: any) => ({
              authorType: m.authorType,
              ...(m.authorName ? { authorName: m.authorName } : {}),
              body: m.body,
            })),
            instructions:
              "REDO ROUND: an earlier PR for this item was already merged, " +
              "but the contributor found problems while trying the change on " +
              "staging — the latest user messages in `thread` describe " +
              "what's wrong (screenshotUrls includes any pictures they " +
              "attached). Start from the latest base branch (the merged code " +
              "is already in it), fix the reported problems, and open a NEW " +
              "pull request on a fresh branch. Report callbacks as usual " +
              "(IN_PROGRESS when you start, CODE_REVIEW with the new prUrl " +
              "once the PR is open and CI is green). Never merge the PR.",
          }
        : {}),
    };

    try {
      const res = await fireRoutine(triggerUrl, token, payload);
      if (!res.ok) {
        await ctx.runMutation(refs.bugs.recordDispatchError, {
          bugId: args.bugId,
          error: `Routine POST ${res.status}: ${await res.text()}`,
        });
      }
    } catch (error) {
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: String(error),
      });
    }
  },
});

// ==========================================================================
// dispatchSpec (spec draft / revision)
// ==========================================================================

export const dispatchSpec = internalActionGeneric({
  args: { bugId: v.id("devBugs"), revision: v.optional(v.boolean()) },
  handler: async (ctx: any, args): Promise<void> => {
    const cfg = getDevAssistantConfig();
    const refs = getDevAssistantRefs();
    const bug = await ctx.runQuery(refs.bugs.getBug, { bugId: args.bugId });
    if (!bug) return;

    const { triggerUrl, token } = routineTrigger("spec");
    if (!triggerUrl || !token) {
      console.error("[DevAssistant] CLAUDE_ROUTINES_* env not configured");
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: "Routine trigger env not configured",
      });
      return;
    }

    const routineRunId = crypto.randomUUID();
    const marked = await ctx.runMutation(refs.bugs.markSpecDispatched, {
      bugId: args.bugId,
      routineRunId,
      revision: args.revision,
    });
    if (marked.alreadyDispatched) return;

    const thread = await ctx.runQuery(refs.bugs.getThreadHistory, {
      bugId: args.bugId,
    });

    const areaList = cfg.areas.map((a) => `"${a}"`).join(", ");
    const baseInstructions =
      "Spec-drafting mode: do NOT write code or open a PR. Investigate the " +
      "codebase, draft an implementation spec (markdown), and propose a risk " +
      'level ("low" = single-screen UI/copy only; "medium" = one feature\'s ' +
      'logic on one side of the stack, nothing shared; "high" = shared ' +
      "components, frontend + backend together, schema/auth/notifications/" +
      "offline). Also triage the request: aiTitle (short imperative headline, " +
      'e.g. "Fix crash when tapping Save"); ' +
      `area (one of: ${areaList}); scope ("buildable" | "split" | ` +
      '"design_needed") — requests too large for one pipeline run must NOT be ' +
      'specced as-is: for "split", the spec body should explain why and ' +
      "propose 2-3 smaller buildable slices AND you MUST return a " +
      "`splitSlices` array (one entry per slice) where each entry is { title, " +
      "prompt }: `title` is the slice's short name and `prompt` is a " +
      "self-contained instruction a maintainer can paste straight into a fresh " +
      "dev session to build THAT slice alone (state the slice's goal, the " +
      "files/areas involved, the done-when checklist, and that it is one " +
      "slice of a larger split so the other slices are out of scope); for " +
      '"design_needed", the spec body should explain what architectural ' +
      "decisions a maintainer must make first; and verifyOnStaging (boolean — " +
      "true for anything interactive, false for pure copy/color). Report back " +
      'by POSTing the signed callback with { bugId, routineRunId, status: ' +
      '"IN_REVIEW", spec, riskLevel, aiTitle, area, scope, splitSlices?, ' +
      "verifyOnStaging }.";
    const instructions = args.revision
      ? "REVISION ROUND: this contribution already has a spec draft — the " +
        "payload's `spec` field carries its CURRENT full text (the thread " +
        "only contains short pointers to it, not the plan itself) — and the " +
        "contributor replied in the conversation thread (see `thread` — the " +
        "latest user message is what you must respond to). Revise that spec " +
        "and triage accordingly. " +
        baseInstructions
      : baseInstructions;

    const screenshotUrls = resolveShots(
      Array.from(
        new Set([
          ...(bug.screenshotUrls ?? []),
          ...thread.flatMap((m: any) => m.imageUrls ?? []),
        ]),
      ),
    );

    const payload = {
      mode: "spec",
      ...(args.revision ? { revision: true } : {}),
      bugId: args.bugId,
      routineRunId,
      kind: bug.kind ?? "bug",
      title: bug.title,
      body: bug.body,
      repro: bug.repro,
      spec: bug.spec,
      screenshotUrls: screenshotUrls.length > 0 ? screenshotUrls : undefined,
      thread: thread.map((m: any) => ({
        authorType: m.authorType,
        ...(m.authorName ? { authorName: m.authorName } : {}),
        body: m.body,
      })),
      callbackUrl: callbackUrl(),
      instructions,
    };

    try {
      const res = await fireRoutine(triggerUrl, token, payload);
      if (!res.ok) {
        await ctx.runMutation(refs.bugs.recordDispatchError, {
          bugId: args.bugId,
          error: `Routine POST ${res.status}: ${await res.text()}`,
        });
      }
    } catch (error) {
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: String(error),
      });
    }
  },
});

// ==========================================================================
// dispatchReview
// ==========================================================================

export const dispatchReview = internalActionGeneric({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx: any, args): Promise<void> => {
    const refs = getDevAssistantRefs();
    const bug = await ctx.runQuery(refs.bugs.getBug, { bugId: args.bugId });
    if (!bug) return;
    if (!bug.prUrl) {
      console.error(
        "[DevAssistant] dispatchReview skipped: bug has no prUrl",
        args.bugId,
      );
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: "Review dispatch skipped: bug has no prUrl",
      });
      return;
    }
    const { triggerUrl, token } = routineTrigger("review");
    if (!triggerUrl || !token) {
      console.error("[DevAssistant] CLAUDE_ROUTINES_* env not configured");
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: "Routine trigger env not configured",
      });
      return;
    }
    const routineRunId = crypto.randomUUID();
    const marked = await ctx.runMutation(refs.bugs.markReviewDispatched, {
      bugId: args.bugId,
      routineRunId,
    });
    if (marked.alreadyDispatched) return;

    const instructions =
      "Review mode: do NOT implement changes — review the open pull request. " +
      "(a) Check out the PR and review its diff against the spec using " +
      "parallel reviewer subagents, one each for correctness, security, " +
      "spec-fidelity/UX, and tests; adversarially verify every finding before " +
      "reporting it and discard anything that doesn't survive. (b) Post the " +
      "surviving findings as GitHub PR review comments (inline on the relevant " +
      "lines where possible) so the review is publicly visible on the PR. " +
      "(c) Report back by POSTing the signed callback with { bugId, " +
      'routineRunId, status: "CODE_REVIEW", reviewVerdict, reviewSummary }: ' +
      'reviewVerdict is "approved" (no blocking findings) or ' +
      '"changes_requested", and reviewSummary is a short one-to-two sentence ' +
      "summary of the review outcome.";

    const payload = {
      mode: "review",
      bugId: args.bugId,
      routineRunId,
      prUrl: bug.prUrl,
      title: bug.title,
      aiTitle: bug.aiTitle,
      spec: bug.spec,
      riskLevel: bug.riskLevel,
      callbackUrl: callbackUrl(),
      instructions,
    };

    try {
      const res = await fireRoutine(triggerUrl, token, payload);
      if (!res.ok) {
        await ctx.runMutation(refs.bugs.recordDispatchError, {
          bugId: args.bugId,
          error: `Routine POST ${res.status}: ${await res.text()}`,
        });
      }
    } catch (error) {
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: String(error),
      });
    }
  },
});

// ==========================================================================
// dispatchFix (runs on the implement Routine — fixing needs push access)
// ==========================================================================

export const dispatchFix = internalActionGeneric({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx: any, args): Promise<void> => {
    const refs = getDevAssistantRefs();
    const bug = await ctx.runQuery(refs.bugs.getBug, { bugId: args.bugId });
    if (!bug) return;
    if (!bug.prUrl) {
      console.error(
        "[DevAssistant] dispatchFix skipped: bug has no prUrl",
        args.bugId,
      );
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: "Fix dispatch skipped: bug has no prUrl",
      });
      return;
    }
    const { triggerUrl, token } = routineTrigger("implement");
    if (!triggerUrl || !token) {
      console.error("[DevAssistant] CLAUDE_ROUTINES_* env not configured");
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: "Routine trigger env not configured",
      });
      return;
    }
    const routineRunId = crypto.randomUUID();
    const marked = await ctx.runMutation(refs.bugs.markFixDispatched, {
      bugId: args.bugId,
      routineRunId,
    });
    if (marked.alreadyDispatched) return;

    const instructions =
      "Fix mode: the code review requested changes on the open pull request — " +
      "do NOT open a new PR. Read the PR's review comments, address every " +
      "finding with a code change (or reply on the comment explaining why no " +
      "change is needed), push your fixes to the SAME branch, and get CI " +
      "green. Then report back by POSTing the signed callback with { bugId, " +
      'routineRunId, status: "CODE_REVIEW" } — a fresh review round is ' +
      "dispatched from that callback. Never merge the PR.";

    const payload = {
      mode: "fix",
      bugId: args.bugId,
      routineRunId,
      prUrl: bug.prUrl,
      spec: bug.spec,
      riskLevel: bug.riskLevel,
      reviewSummary: bug.reviewSummary,
      callbackUrl: callbackUrl(),
      instructions,
    };

    try {
      const res = await fireRoutine(triggerUrl, token, payload);
      if (!res.ok) {
        await ctx.runMutation(refs.bugs.recordDispatchError, {
          bugId: args.bugId,
          error: `Routine POST ${res.status}: ${await res.text()}`,
        });
      }
    } catch (error) {
      await ctx.runMutation(refs.bugs.recordDispatchError, {
        bugId: args.bugId,
        error: String(error),
      });
    }
  },
});

// ==========================================================================
// Policy auto-merge (Phase 3)
// ==========================================================================

export const attemptAutoMerge = internalActionGeneric({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx: any, args): Promise<void> => {
    const cfg = getDevAssistantConfig();
    const refs = getDevAssistantRefs();
    if (process.env.AUTO_MERGE_ENABLED !== "true") {
      console.log(
        '[DevAssistant] Auto-merge skipped: AUTO_MERGE_ENABLED is not "true"',
      );
      return;
    }

    const bug = await ctx.runQuery(refs.bugs.getBug, { bugId: args.bugId });
    if (!bug) return;

    if (
      bug.status !== "READY_TO_MERGE" ||
      bug.reviewVerdict !== "approved" ||
      !bug.prUrl
    ) {
      console.log("[DevAssistant] Auto-merge gates not met for bug", args.bugId);
      return;
    }

    const cap = await ctx.runQuery(refs.maintainers.getAutoMergeCapForUser, {
      userId: bug.originatorUserId,
    });
    if (!isWithinAutoMergeCap(bug.riskLevel, cap)) {
      console.log("[DevAssistant] Auto-merge blocked by severity cap", args.bugId, {
        riskLevel: bug.riskLevel,
        cap,
      });
      return;
    }

    const blocked = async (reason: string): Promise<void> => {
      console.error("[DevAssistant] Auto-merge blocked:", reason, args.bugId);
      await ctx.runMutation(refs.bugs.addSystemThreadMessage, {
        bugId: args.bugId,
        body: `Auto-merge blocked: ${reason} — needs a maintainer`,
      });
    };

    const prNumber = prNumberFromUrl(bug.prUrl);
    if (!prNumber) {
      await blocked(`could not parse a PR number from ${bug.prUrl}`);
      return;
    }
    const mirrorToken = githubMirrorToken();
    if (!mirrorToken) {
      await blocked("GH_MIRROR_TOKEN not configured");
      return;
    }

    try {
      const res = await mergePullRequestOnGithub(cfg.repo, prNumber, mirrorToken);
      if (res.ok) {
        await ctx.runMutation(refs.bugs.addSystemThreadMessage, {
          bugId: args.bugId,
          body: "Auto-merged ✓ — all gates passed (review approved, within severity cap)",
        });
        await applyGithubConfirmedMerge(ctx, bug, await readMergeCommitSha(res));
        return;
      }
      const raced = await fetchPrMerged(cfg.repo, prNumber, mirrorToken);
      if (raced?.merged) {
        await applyGithubConfirmedMerge(ctx, bug, raced.mergeCommitSha);
        return;
      }
      await blocked(await githubErrorDetail(res, "GitHub merge"));
    } catch (error) {
      await blocked(String(error));
    }
  },
});

// ==========================================================================
// In-app merge button (mergeFromApp + retryMergeAfterUpdate)
// ==========================================================================

export const mergeFromApp = internalActionGeneric({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx: any, args): Promise<void> => {
    const cfg = getDevAssistantConfig();
    const refs = getDevAssistantRefs();
    const bug = await ctx.runQuery(refs.bugs.getBug, { bugId: args.bugId });
    if (!bug) return;

    const failed = async (reason: string): Promise<void> => {
      console.error("[DevAssistant] In-app merge failed:", reason, args.bugId);
      await ctx.runMutation(refs.bugs.recordMergeFromAppFailure, {
        bugId: args.bugId,
        reason,
      });
    };

    if (bug.status === "MERGED") return;
    if (
      bug.status !== "READY_TO_MERGE" ||
      bug.reviewVerdict !== "approved" ||
      !bug.prUrl
    ) {
      await failed("This item is no longer ready to merge.");
      return;
    }

    const prNumber = prNumberFromUrl(bug.prUrl);
    if (!prNumber) {
      await failed(describeMergeBlock("unknown"));
      return;
    }
    const mirrorToken = githubMirrorToken();
    if (!mirrorToken) {
      await failed(describeMergeBlock("permission"));
      return;
    }

    try {
      const res = await mergePullRequestOnGithub(cfg.repo, prNumber, mirrorToken);
      if (res.ok) {
        await applyGithubConfirmedMerge(ctx, bug, await readMergeCommitSha(res));
        return;
      }

      // Log the raw GitHub reason for the breadcrumb, then diagnose *why* the
      // merge was blocked from the PR's mergeability rather than surfacing
      // the raw failure to the maintainer.
      console.error(
        "[DevAssistant] In-app merge PUT failed:",
        await githubErrorDetail(res, "GitHub merge"),
        args.bugId,
      );

      const status = await fetchPrMerged(cfg.repo, prNumber, mirrorToken);
      if (status?.merged) {
        await applyGithubConfirmedMerge(ctx, bug, status.mergeCommitSha);
        return;
      }
      const state = status?.mergeableState;

      if (state === "behind" || isMergeableState(state)) {
        if (state === "behind") {
          const upd = await updatePullRequestBranch(cfg.repo, prNumber, mirrorToken);
          if (upd.status === 401 || upd.status === 403) {
            await failed(describeMergeBlock("permission"));
            return;
          }
          if (upd.status === 409) {
            await failed(describeMergeBlock("conflict"));
            return;
          }
          if (!upd.ok) {
            await failed(describeMergeBlock("failing"));
            return;
          }
          await ctx.runMutation(refs.bugs.addSystemThreadMessage, {
            bugId: args.bugId,
            body: MERGE_BEHIND_RECOVERING_MESSAGE,
          });
        }
        await ctx.scheduler.runAfter(
          mergeRecoveryPollDelayMs(0),
          refs.actions.retryMergeAfterUpdate,
          { bugId: args.bugId, attempt: 0 },
        );
        return; // latch stays set — recovery is in flight
      }

      if (state === "dirty") {
        await failed(describeMergeBlock("conflict"));
        return;
      }
      await failed(describeMergeBlock(state ? "failing" : "unknown"));
    } catch (error) {
      console.error("[DevAssistant] In-app merge threw:", error, args.bugId);
      await failed(describeMergeBlock("unknown"));
    }
  },
});

export const retryMergeAfterUpdate = internalActionGeneric({
  args: { bugId: v.id("devBugs"), attempt: v.number() },
  handler: async (ctx: any, args): Promise<void> => {
    const cfg = getDevAssistantConfig();
    const refs = getDevAssistantRefs();
    const bug = await ctx.runQuery(refs.bugs.getBug, { bugId: args.bugId });
    if (!bug) return;
    if (bug.status === "MERGED") return;

    const failed = async (reason: string): Promise<void> => {
      console.error(
        "[DevAssistant] In-app merge recovery failed:",
        reason,
        args.bugId,
      );
      await ctx.runMutation(refs.bugs.recordMergeFromAppFailure, {
        bugId: args.bugId,
        reason,
      });
    };

    if (
      bug.status !== "READY_TO_MERGE" ||
      bug.reviewVerdict !== "approved" ||
      !bug.prUrl
    ) {
      await failed("This item is no longer ready to merge.");
      return;
    }
    const prNumber = prNumberFromUrl(bug.prUrl);
    if (!prNumber) {
      await failed(describeMergeBlock("unknown"));
      return;
    }
    const mirrorToken = githubMirrorToken();
    if (!mirrorToken) {
      await failed(describeMergeBlock("permission"));
      return;
    }

    const pollAgainOrGiveUp = async (): Promise<void> => {
      if (args.attempt + 1 >= MERGE_RECOVERY_MAX_POLLS) {
        await failed(describeMergeBlock("failing"));
        return;
      }
      await ctx.scheduler.runAfter(
        mergeRecoveryPollDelayMs(args.attempt + 1),
        refs.actions.retryMergeAfterUpdate,
        { bugId: args.bugId, attempt: args.attempt + 1 },
      );
    };

    try {
      const status = await fetchPrMerged(cfg.repo, prNumber, mirrorToken);
      if (status?.merged) {
        await applyGithubConfirmedMerge(ctx, bug, status.mergeCommitSha);
        return;
      }
      const state = status?.mergeableState;
      if (isMergeableState(state)) {
        const res = await mergePullRequestOnGithub(cfg.repo, prNumber, mirrorToken);
        if (res.ok) {
          await applyGithubConfirmedMerge(ctx, bug, await readMergeCommitSha(res));
          return;
        }
        const raced = await fetchPrMerged(cfg.repo, prNumber, mirrorToken);
        if (raced?.merged) {
          await applyGithubConfirmedMerge(ctx, bug, raced.mergeCommitSha);
          return;
        }
        await pollAgainOrGiveUp();
        return;
      }
      if (state === "dirty") {
        await failed(describeMergeBlock("conflict"));
        return;
      }
      await pollAgainOrGiveUp();
    } catch (error) {
      console.error("[DevAssistant] In-app merge recovery threw:", error, args.bugId);
      await pollAgainOrGiveUp();
    }
  },
});

// ==========================================================================
// In-app production deploy (silent OTA)
// ==========================================================================

export const dispatchProductionDeploy = internalActionGeneric({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx: any, args): Promise<void> => {
    const cfg = getDevAssistantConfig();
    const refs = getDevAssistantRefs();
    const outcome = async (ok: boolean, detail?: string): Promise<void> => {
      if (!ok) {
        console.error(
          "[DevAssistant] Production deploy dispatch failed:",
          detail,
          args.bugId,
        );
      }
      await ctx.runMutation(refs.bugs.recordProductionDeployOutcome, {
        bugId: args.bugId,
        ok,
        detail,
      });
    };
    const token = githubMirrorToken();
    if (!token) {
      await outcome(false, "GH_MIRROR_TOKEN not configured");
      return;
    }
    try {
      const res = await fetch(workflowDispatchEndpoint(cfg.repo), {
        method: "POST",
        headers: githubJsonHeaders(token),
        body: JSON.stringify({
          ref: cfg.repo.baseBranch,
          inputs: cfg.repo.productionDeployInputs,
        }),
      });
      if (res.status === 204) {
        await outcome(true);
        return;
      }
      await outcome(false, await githubErrorDetail(res, "GitHub workflow dispatch"));
    } catch (error) {
      await outcome(false, String(error));
    }
  },
});

// ==========================================================================
// reconcile backstop
// ==========================================================================

export const reconcileMergedPrs = internalActionGeneric({
  args: {},
  handler: async (ctx: any): Promise<void> => {
    const cfg = getDevAssistantConfig();
    const refs = getDevAssistantRefs();
    const token = githubMirrorToken();
    if (!token) return;
    const bugs = await ctx.runQuery(refs.bugs.listOpenPrBugs, {});
    for (const bug of bugs) {
      if (!bug.prUrl) continue;
      const prNumber = prNumberFromUrl(bug.prUrl);
      if (!prNumber) continue;
      try {
        const merged = await fetchPrMerged(cfg.repo, prNumber, token);
        if (merged?.merged) {
          await ctx.runMutation(refs.bugs.handleGithubPrClosed, {
            branchRef: "",
            prUrl: bug.prUrl,
            merged: true,
            mergeCommitSha: merged.mergeCommitSha,
          });
        }
      } catch (error) {
        console.error(
          "[DevAssistant] reconcileMergedPrs failed for",
          bug.prUrl,
          String(error),
        );
      }
    }
  },
});

// ==========================================================================
// handleRoutineCallback — correlate + apply + notify
// ==========================================================================

export const handleRoutineCallback = internalActionGeneric({
  args: {
    bugId: v.id("devBugs"),
    routineRunId: v.string(),
    status: bugStatusValidator,
    source: v.optional(callbackSourceValidator),
    mergeCommitSha: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    screenshots: v.optional(v.array(v.string())),
    message: v.optional(v.string()),
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
  handler: async (ctx: any, args): Promise<void> => {
    const cfg = getDevAssistantConfig();
    const refs = getDevAssistantRefs();
    const bug = await ctx.runQuery(refs.bugs.getBugByRoutineRunId, {
      routineRunId: args.routineRunId,
    });
    if (!bug || bug._id !== args.bugId) {
      console.error(
        "[DevAssistant] Callback bug/routineRunId mismatch",
        args.routineRunId,
        args.bugId,
      );
      return;
    }

    const updated = await ctx.runMutation(refs.bugs.applyCallback, {
      bugId: args.bugId,
      status: args.status,
      source: args.source,
      mergeCommitSha: args.mergeCommitSha,
      prUrl: args.prUrl,
      screenshots: args.screenshots,
      spec: args.spec,
      riskLevel: args.riskLevel,
      aiTitle: args.aiTitle,
      area: args.area,
      scope: args.scope,
      splitSlices: args.splitSlices,
      verifyOnStaging: args.verifyOnStaging,
      reviewVerdict: args.reviewVerdict,
      reviewSummary: args.reviewSummary,
    });
    if (!updated) return;
    if (updated.lastError !== undefined) {
      console.warn(
        `[DevAssistant] Rejected callback ${args.status} for bug ${args.bugId}: ${updated.lastError}`,
      );
      return;
    }

    const promoted =
      args.reviewVerdict === "approved" &&
      args.status === "CODE_REVIEW" &&
      updated.status === "READY_TO_MERGE";
    const effectiveStatus = promoted ? "READY_TO_MERGE" : args.status;
    if (updated.status !== effectiveStatus) {
      console.warn(
        `[DevAssistant] Ignored callback ${args.status} for bug ${args.bugId} (current status ${updated.status})`,
      );
      return;
    }

    const statusChanged = bug.status !== updated.status;
    const specChanged = args.spec !== undefined && args.spec !== bug.spec;

    // Push events — the notifier routes these to the originator (Togather:
    // dashboard items only). Mirrors contributorPushForStatus.
    if (statusChanged) {
      if (effectiveStatus === "IN_REVIEW" && updated.spec) {
        await cfg.notifier.notify(ctx, { type: "specReady", bug: updated });
      } else if (effectiveStatus === "CODE_REVIEW") {
        await cfg.notifier.notify(ctx, { type: "prOpened", bug: updated });
      }
      // READY_TO_MERGE / MERGED intentionally push nothing (the staging-live
      // notice fires later from handleWorkflowRunEvent).
    } else if (specChanged) {
      await cfg.notifier.notify(ctx, { type: "specRevised", bug: updated });
    }

    // Chat progress mirror — the notifier routes this to a chat thread
    // (Togather: chat-originated items only), deduped by sourceKey.
    const content =
      args.message ??
      defaultCallbackMessage(effectiveStatus, args.prUrl ?? updated.prUrl);
    const sourceKey =
      (updated.redoRounds ?? 0) > 0
        ? `bug:${args.bugId}:${effectiveStatus}:r${updated.redoRounds}`
        : `bug:${args.bugId}:${effectiveStatus}`;
    await cfg.notifier.notify(ctx, {
      type: "chatStatusUpdate",
      bug: updated,
      effectiveStatus,
      prUrl: args.prUrl ?? updated.prUrl,
      message: content,
      sourceKey,
    });
  },
});
