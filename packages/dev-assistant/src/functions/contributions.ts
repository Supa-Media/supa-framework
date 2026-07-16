/**
 * Contributor dashboard surface — dashboard-originated devBugs (ADR-029 Phase 1
 * + 1.5 conversation layer). Ported faithfully from Togather's
 * `devAssistant/contributions.ts`. Auth/role → `cfg.authenticate` +
 * `cfg.canUseDevAssistant`; attachment/media handling → `cfg`; push side
 * effects → `cfg.notifier`; scheduling → `refs`.
 */

import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { ResolvedDevAssistantConfig } from "../config";
import type { DevAssistantRefs } from "./refs";
import { applyStatusTransition, insertThreadMessage } from "./dbHelpers";
import { deriveTitle } from "../pipeline/text";

export function makeContributionsFunctions(
  cfg: ResolvedDevAssistantConfig,
  refs: DevAssistantRefs,
) {
  const contributionKindValidator = v.union(
    v.literal("bug"),
    v.literal("feature"),
  );

  // ---- helpers ----
  const requireContributor = async (ctx: any, token: string): Promise<any> => {
    const userId = await cfg.authenticate(ctx, token);
    if (!(await cfg.canUseDevAssistant(ctx, userId))) {
      throw new Error("Not authorized: dev maintainer access required");
    }
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Not authorized");
    return user;
  };

  const assertValidAttachments = (urls: string[] | undefined): void => {
    if (!urls) return;
    for (const url of urls) cfg.assertValidAttachment(url);
  };

  const resolveImageUrls = (
    urls: string[] | undefined,
  ): string[] | undefined => {
    if (!urls || urls.length === 0) return undefined;
    const resolved = urls
      .map((u) => cfg.resolveMediaUrl(u))
      .filter((u): u is string => !!u);
    return resolved.length > 0 ? resolved : undefined;
  };

  const displayName = (user: any, fallback: string): string =>
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || fallback;

  const assertBuildableScope = (bug: any): void => {
    if (bug.scope !== undefined && bug.scope !== "buildable") {
      throw new Error(
        bug.scope === "split"
          ? "This request is too large for one build — see the spec for the proposed smaller slices"
          : "This request needs maintainer design decisions before it can be built",
      );
    }
  };

  const assertNotArchived = (bug: any): void => {
    if (bug.archivedAt) {
      throw new Error("Restore this conversation before continuing it");
    }
  };

  const assertCanArchive = (user: any, bug: any): void => {
    const isOwner = bug.originatorUserId === user._id;
    if (!isOwner && !user.isStaff && !user.isSuperuser) {
      throw new Error("Only the person who started this can archive it");
    }
  };

  const isStagingDeployLive = (bug: any): boolean =>
    bug.stagingDeploy === undefined || bug.stagingDeploy.state === "live";

  const assertStagingDeployLive = (bug: any): void => {
    if (isStagingDeployLive(bug)) return;
    throw new Error(
      bug.stagingDeploy?.state === "failed"
        ? "The staging deploy failed — contact the lead maintainer instead."
        : "The staging deploy is still running — wait for it to finish.",
    );
  };

  const assertStagingWindow = (bug: any): void => {
    if (!bug.verifyOnStaging) {
      throw new Error("This item does not require staging verification");
    }
    if (bug.stagingVerifiedAt) {
      throw new Error("This item was already verified on staging");
    }
    if (bug.status !== "MERGED") {
      throw new Error(
        `Staging can only be checked once the change is merged and live on staging (current status: ${bug.status})`,
      );
    }
    assertStagingDeployLive(bug);
  };

  // ==========================================================================
  // GitHub attribution
  // ==========================================================================
  const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
  const GITHUB_USERNAME_MAX_LENGTH = 39;

  const getGithubUsername = queryGeneric({
    args: { token: v.string() },
    handler: async (ctx: any, args: any): Promise<string | null> => {
      const user = await requireContributor(ctx, args.token);
      return user.githubUsername ?? null;
    },
  });

  const setGithubUsername = mutationGeneric({
    args: { token: v.string(), username: v.string() },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      let username = args.username.trim();
      if (username.startsWith("@")) username = username.slice(1).trim();
      if (username === "") {
        await ctx.db.patch(user._id, {
          githubUsername: undefined,
          updatedAt: Date.now(),
        });
        return { ok: true };
      }
      if (
        username.length > GITHUB_USERNAME_MAX_LENGTH ||
        !GITHUB_USERNAME_REGEX.test(username)
      ) {
        throw new Error(
          "Invalid GitHub username: use letters, numbers, and hyphens only " +
            "(no leading, trailing, or consecutive hyphens; max 39 characters)",
        );
      }
      await ctx.db.patch(user._id, {
        githubUsername: username,
        updatedAt: Date.now(),
      });
      return { ok: true };
    },
  });

  // ==========================================================================
  // Mutations
  // ==========================================================================

  const submit = mutationGeneric({
    args: {
      token: v.string(),
      kind: contributionKindValidator,
      title: v.optional(v.string()),
      body: v.string(),
      repro: v.optional(v.string()),
      screenshotUrls: v.optional(v.array(v.string())),
    },
    handler: async (ctx: any, args: any): Promise<string> => {
      const user = await requireContributor(ctx, args.token);

      const body = args.body.trim();
      assertValidAttachments(args.screenshotUrls);
      const hasImages =
        !!args.screenshotUrls && args.screenshotUrls.length > 0;
      if (!body && !hasImages) {
        throw new Error("Add a description or a screenshot");
      }
      const title =
        args.title?.trim() ||
        (body
          ? deriveTitle(body)
          : args.kind === "feature"
            ? "Feature idea"
            : "Bug report");

      const now = Date.now();
      const bugId = await ctx.db.insert("devBugs", {
        originatorUserId: user._id,
        status: "DRAFT",
        kind: args.kind,
        source: "dashboard",
        title,
        body,
        repro: args.repro,
        screenshotUrls: args.screenshotUrls,
        createdAt: now,
        updatedAt: now,
      });

      const openingTurn = args.repro
        ? `${body}\n\nHow to see it: ${args.repro}`
        : body;
      await insertThreadMessage(
        ctx,
        bugId,
        "user",
        openingTurn,
        user._id,
        args.screenshotUrls,
      );

      await ctx.scheduler.runAfter(0, refs.actions.dispatchSpec, { bugId });
      return bugId;
    },
  });

  const approveSpec = mutationGeneric({
    args: { token: v.string(), id: v.id("devBugs") },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) throw new Error("Contribution not found");
      assertNotArchived(bug);
      if (bug.status !== "IN_REVIEW") {
        throw new Error(
          `Spec can only be approved while in review (current status: ${bug.status})`,
        );
      }
      if (!bug.spec) throw new Error("This item has no spec to approve yet");
      assertBuildableScope(bug);

      const now = Date.now();
      await ctx.db.patch(args.id, { specApprovedAt: now, updatedAt: now });

      const autoDispatched = bug.riskLevel === "low";
      if (autoDispatched) {
        await applyStatusTransition(ctx, bug, "READY_FOR_IMPL", refs);
        await cfg.notifier.notify(ctx, {
          type: "buildStarted",
          bug,
          actorUserId: user._id,
        });
      }
      return { ok: true, autoDispatched };
    },
  });

  const startBuild = mutationGeneric({
    args: { token: v.string(), id: v.id("devBugs") },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) throw new Error("Contribution not found");
      assertNotArchived(bug);
      if (!bug.specApprovedAt) {
        throw new Error("Spec must be approved before starting a build");
      }
      if (bug.status !== "IN_REVIEW") {
        throw new Error(
          `Build can only be started from review (current status: ${bug.status})`,
        );
      }
      assertBuildableScope(bug);
      await applyStatusTransition(ctx, bug, "READY_FOR_IMPL", refs);
      await cfg.notifier.notify(ctx, {
        type: "buildStarted",
        bug,
        actorUserId: user._id,
      });
      return { ok: true };
    },
  });

  const archive = mutationGeneric({
    args: { token: v.string(), id: v.id("devBugs") },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) throw new Error("Contribution not found");
      assertCanArchive(user, bug);
      if (!bug.archivedAt) {
        const now = Date.now();
        await ctx.db.patch(args.id, { archivedAt: now, updatedAt: now });
        await insertThreadMessage(
          ctx,
          args.id,
          "system",
          "Conversation archived — set aside by the contributor.",
        );
      }
      return { ok: true };
    },
  });

  const unarchive = mutationGeneric({
    args: { token: v.string(), id: v.id("devBugs") },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) throw new Error("Contribution not found");
      assertCanArchive(user, bug);
      if (bug.archivedAt) {
        await ctx.db.patch(args.id, {
          archivedAt: undefined,
          updatedAt: Date.now(),
        });
        await insertThreadMessage(
          ctx,
          args.id,
          "system",
          "Conversation restored.",
        );
      }
      return { ok: true };
    },
  });

  const postMessage = mutationGeneric({
    args: {
      token: v.string(),
      id: v.id("devBugs"),
      body: v.string(),
      imageUrls: v.optional(v.array(v.string())),
    },
    handler: async (ctx: any, args: any): Promise<string> => {
      const user = await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) throw new Error("Contribution not found");

      const body = args.body.trim();
      assertValidAttachments(args.imageUrls);
      const hasImages = !!args.imageUrls && args.imageUrls.length > 0;
      if (!body && !hasImages) throw new Error("Message body is required");

      const messageId = await insertThreadMessage(
        ctx,
        args.id,
        "user",
        body,
        user._id,
        args.imageUrls,
      );

      if (
        !bug.archivedAt &&
        (bug.status === "DRAFT" || bug.status === "IN_REVIEW")
      ) {
        await ctx.scheduler.runAfter(0, refs.actions.dispatchSpec, {
          bugId: args.id,
          revision: true,
        });
      }
      await ctx.db.patch(args.id, { updatedAt: Date.now() });
      return messageId;
    },
  });

  const confirmStaging = mutationGeneric({
    args: { token: v.string(), id: v.id("devBugs") },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) throw new Error("Contribution not found");
      assertStagingWindow(bug);

      const now = Date.now();
      await ctx.db.patch(args.id, { stagingVerifiedAt: now, updatedAt: now });

      const name = displayName(user, "A contributor");
      await insertThreadMessage(
        ctx,
        args.id,
        "system",
        `${name} confirmed it works on staging — ready for a maintainer to deploy to production`,
      );
      await cfg.notifier.notify(ctx, {
        type: "stagingVerified",
        bug,
        actorUserId: user._id,
      });
      return { ok: true };
    },
  });

  const reportStagingIssue = mutationGeneric({
    args: { token: v.string(), id: v.id("devBugs"), note: v.string() },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) throw new Error("Contribution not found");
      assertStagingWindow(bug);

      const note = args.note.trim();
      if (!note) throw new Error("A note describing the issue is required");

      await insertThreadMessage(ctx, args.id, "user", note, user._id);
      await insertThreadMessage(
        ctx,
        args.id,
        "system",
        "Staging check failed — sending it back to the AI to fix",
      );

      await ctx.db.patch(args.id, {
        prUrl: undefined,
        reviewVerdict: undefined,
        reviewSummary: undefined,
        fixRounds: 0,
        redoRounds: (bug.redoRounds ?? 0) + 1,
        routineRunId: undefined,
        activeRunMode: undefined,
        lastError: undefined,
        updatedAt: Date.now(),
      });

      const fresh = await ctx.db.get(args.id);
      if (fresh) {
        await applyStatusTransition(ctx, fresh, "READY_FOR_IMPL", refs);
      }
      await cfg.notifier.notify(ctx, {
        type: "stagingRedo",
        bug,
        actorUserId: user._id,
      });
      return { ok: true };
    },
  });

  const mergeNow = mutationGeneric({
    args: { token: v.string(), id: v.id("devBugs") },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) throw new Error("Contribution not found");
      assertNotArchived(bug);
      if (bug.status !== "READY_TO_MERGE") {
        throw new Error(
          `This item isn't ready to merge (current status: ${bug.status})`,
        );
      }
      if (bug.reviewVerdict !== "approved") {
        throw new Error("Code review hasn't approved this change yet");
      }
      if (!bug.prUrl) throw new Error("This item has no pull request to merge");
      if (bug.mergeRequestedAt) {
        throw new Error("A merge is already in flight for this item");
      }

      const name = displayName(user, "A maintainer");
      await insertThreadMessage(
        ctx,
        args.id,
        "system",
        `${name} asked to merge this from the app — merging…`,
      );
      await ctx.db.patch(args.id, {
        mergeRequestedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, refs.actions.mergeFromApp, {
        bugId: args.id,
      });
      return { ok: true };
    },
  });

  const promoteToProduction = mutationGeneric({
    args: { token: v.string(), id: v.id("devBugs") },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) throw new Error("Contribution not found");
      assertNotArchived(bug);
      if (bug.status !== "MERGED") {
        throw new Error(
          `Only merged changes can ship to production (current status: ${bug.status})`,
        );
      }
      if (bug.verifyOnStaging !== false && !bug.stagingVerifiedAt) {
        throw new Error(
          "Confirm the change works on staging before shipping it to production",
        );
      }
      assertStagingDeployLive(bug);
      const now = Date.now();
      if (
        bug.productionRequestedAt &&
        now - bug.productionRequestedAt < cfg.productionRetriggerCooldownMs
      ) {
        throw new Error(
          "A production deploy was already triggered for this item — give it a few minutes",
        );
      }

      await ctx.db.patch(args.id, {
        productionRequestedAt: now,
        updatedAt: now,
      });
      const name = displayName(user, "A maintainer");
      await insertThreadMessage(
        ctx,
        args.id,
        "system",
        `${name} triggered the production deploy (silent update)`,
      );
      await ctx.scheduler.runAfter(0, refs.actions.dispatchProductionDeploy, {
        bugId: args.id,
      });
      return { ok: true };
    },
  });

  // ==========================================================================
  // Queries
  // ==========================================================================

  const originatorDisplayName = async (
    ctx: any,
    userId: string,
  ): Promise<string | undefined> => {
    const user = await ctx.db.get(userId);
    if (!user) return undefined;
    return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || undefined;
  };

  const withLastMessage = async (ctx: any, bugs: any[]): Promise<any[]> => {
    const distinctIds = [...new Set(bugs.map((b) => b.originatorUserId))];
    const names = new Map<string, string | undefined>(
      await Promise.all(
        distinctIds.map(
          async (id) => [id, await originatorDisplayName(ctx, id)] as const,
        ),
      ),
    );
    return await Promise.all(
      bugs.map(async (bug) => {
        const last = await ctx.db
          .query("devBugMessages")
          .withIndex("by_bug", (q: any) => q.eq("bugId", bug._id))
          .order("desc")
          .first();
        return {
          ...bug,
          lastMessageBody: last?.body,
          lastMessageAuthorType: last?.authorType,
          originatorName: names.get(bug.originatorUserId),
        };
      }),
    );
  };

  const getThread = queryGeneric({
    args: { token: v.string(), id: v.id("devBugs") },
    handler: async (ctx: any, args: any) => {
      await requireContributor(ctx, args.token);
      const messages = await ctx.db
        .query("devBugMessages")
        .withIndex("by_bug", (q: any) => q.eq("bugId", args.id))
        .order("asc")
        .collect();
      return messages.map((m: any) => ({
        ...m,
        imageUrls: resolveImageUrls(m.imageUrls),
      }));
    },
  });

  const myContributions = queryGeneric({
    args: { token: v.string() },
    handler: async (ctx: any, args: any) => {
      const user = await requireContributor(ctx, args.token);
      const bugs = await ctx.db
        .query("devBugs")
        .withIndex("by_originator", (q: any) =>
          q.eq("originatorUserId", user._id),
        )
        .order("desc")
        .take(200);
      return await withLastMessage(ctx, bugs);
    },
  });

  const listAll = queryGeneric({
    args: { token: v.string() },
    handler: async (ctx: any, args: any) => {
      await requireContributor(ctx, args.token);
      const bugs = await ctx.db.query("devBugs").order("desc").take(200);
      return await withLastMessage(ctx, bugs);
    },
  });

  const getContribution = queryGeneric({
    args: { token: v.string(), id: v.id("devBugs") },
    handler: async (ctx: any, args: any) => {
      await requireContributor(ctx, args.token);
      const bug = await ctx.db.get(args.id);
      if (!bug) return null;
      return {
        ...bug,
        screenshotUrls: resolveImageUrls(bug.screenshotUrls),
        planPreviewUrls: resolveImageUrls(bug.planPreviewUrls),
        originatorName: await originatorDisplayName(ctx, bug.originatorUserId),
      };
    },
  });

  return {
    getGithubUsername,
    setGithubUsername,
    submit,
    approveSpec,
    startBuild,
    archive,
    unarchive,
    postMessage,
    confirmStaging,
    reportStagingIssue,
    mergeNow,
    promoteToProduction,
    getThread,
    myContributions,
    listAll,
    getContribution,
  };
}
