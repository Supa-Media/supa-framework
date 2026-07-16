/**
 * `createDevAssistant` — the factory that assembles the pipeline's Convex
 * functions + HTTP routes from a config, mirroring `createSupaAuth` in
 * `@supa-media/convex/auth`. NOT a Convex component: the consumer re-exports the
 * returned functions from their own `functions/devAssistant/{bugs,actions,
 * contributions,maintainers}.ts` and mounts `registerRoutes` in their `http.ts`.
 *
 * Usage:
 * ```ts
 * // convex/functions/devAssistant/_instance.ts
 * import { createDevAssistant } from "@supa-media/dev-assistant";
 * export const devAssistant = createDevAssistant({
 *   functionsPath: "functions/devAssistant",
 *   authenticate: (ctx, token) => requireAuth(ctx, token),
 *   canUseDevAssistant: async (ctx, userId) =>
 *     canUse(await ctx.db.get(userId)),
 *   repo: { owner: "acme", name: "app" },
 *   signatureHeader: "x-togather-signature", // keep legacy header
 *   notifier: myNotifier,
 * });
 *
 * // convex/functions/devAssistant/bugs.ts
 * import { devAssistant } from "./_instance";
 * export const {
 *   getThreadHistory, getBug, getBugByRoutineRunId, getOriginatorAttribution,
 *   listOpenPrBugs, markDispatched, markSpecDispatched, markReviewDispatched,
 *   markFixDispatched, setGithubIssue, recordDispatchError,
 *   addSystemThreadMessage, recordProductionDeployOutcome,
 *   recordMergeFromAppFailure, applyCallback, handleGithubPrClosed,
 *   handleWorkflowRunEvent, getBugForReview, rejectBug, markBugMerged,
 *   retryDispatch,
 * } = devAssistant.bugs;
 *
 * // convex/functions/devAssistant/actions.ts    → export const { ... } = devAssistant.actions;
 * // convex/functions/devAssistant/contributions.ts → export const { ... } = devAssistant.contributions;
 * // convex/functions/devAssistant/maintainers.ts → export const { getAutoMergeCapForUser } = devAssistant.maintainers;
 *
 * // convex/http.ts
 * devAssistant.registerRoutes(http);
 * ```
 */

import { resolveConfig, type DevAssistantConfig } from "../config";
import { makeRefs } from "./refs";
import { makeBugsFunctions } from "./bugs";
import { makeActionsFunctions } from "./actions";
import { makeContributionsFunctions } from "./contributions";
import { makeMaintainersFunctions } from "./maintainers";
import { makeHttpRegistrar } from "./http";

export function createDevAssistant(config: DevAssistantConfig) {
  const cfg = resolveConfig(config);
  const refs = makeRefs(cfg.functionsPath);

  const bugs = makeBugsFunctions(cfg, refs);
  const actions = makeActionsFunctions(cfg, refs);
  const contributions = makeContributionsFunctions(cfg, refs);
  const maintainers = makeMaintainersFunctions(cfg);
  const registerRoutes = makeHttpRegistrar(cfg, refs);

  return { bugs, actions, contributions, maintainers, registerRoutes, config: cfg };
}

export type DevAssistantInstance = ReturnType<typeof createDevAssistant>;
