/**
 * Build-/test-time check that `functionsPath` actually resolves against the
 * consumer's generated Convex `internal` API object.
 *
 * WHY THIS EXISTS: every internal reference the package schedules
 * (`READY_FOR_IMPL → dispatchBug`, `CODE_REVIEW → dispatchReview`, the
 * callback applier, the auto-merge action, …) is built with
 * `makeFunctionReference(\`${functionsPath}/bugs:getBug\`)` in `refs.ts` — a
 * bare string, not a typed reference into the consumer's `_generated/api`.
 * `makeFunctionReference` does no existence check, so a wrong `functionsPath`
 * (or a re-export renamed/dropped along the way) passes `tsc` and `convex
 * deploy` cleanly and only fails at RUNTIME, inside a scheduled function, as
 * "Could not find function" in the Convex log — invisible to the end user and
 * easy to miss in review. There is no dynamic "does this function exist" API
 * inside a Convex function to catch this automatically.
 *
 * `validateMount` closes that gap at the one place it CAN be checked: the
 * consumer's own generated `internal` object, which mirrors the folder/file/
 * export structure 1:1 and is available in a test file (unlike inside a
 * deployed function). Call it from a small `node:test`/`vitest` file in your
 * app right after wiring `functionsPath` — see the README "Smoke test" recipe.
 *
 * Only checks the functions the package actually schedules internally (via
 * `refs.ts`) — `contributions.ts`'s client-facing mutations/queries aren't
 * included: a typo there fails loudly and immediately (a normal Convex
 * "function not found" client error), not silently inside a background job.
 */

const BUG_FUNCTIONS = [
  "getBug",
  "getBugByRoutineRunId",
  "getOriginatorAttribution",
  "getThreadHistory",
  "listOpenPrBugs",
  "applyCallback",
  "markDispatched",
  "markSpecDispatched",
  "markReviewDispatched",
  "markFixDispatched",
  "setGithubIssue",
  "recordDispatchError",
  "addSystemThreadMessage",
  "recordProductionDeployOutcome",
  "recordMergeFromAppFailure",
  "handleGithubPrClosed",
  "handleWorkflowRunEvent",
] as const;

const ACTION_FUNCTIONS = [
  "dispatchBug",
  "dispatchSpec",
  "dispatchReview",
  "dispatchFix",
  "attemptAutoMerge",
  "mergeFromApp",
  "retryMergeAfterUpdate",
  "dispatchProductionDeploy",
  "reconcileMergedPrs",
  "handleRoutineCallback",
] as const;

const MAINTAINER_FUNCTIONS = ["getAutoMergeCapForUser"] as const;

/**
 * Walk `functionsPath` ("a/b/c") as nested property access into `internalApi`
 * (the consumer's generated `internal` object, or `api` — either mirrors the
 * same module tree), returning the module at that path or `undefined` if any
 * segment is missing.
 */
function resolveModuleRoot(internalApi: any, functionsPath: string): any {
  return functionsPath
    .split("/")
    .filter((s) => s.length > 0)
    .reduce((node: any, segment: string) => node?.[segment], internalApi);
}

/**
 * Returns the list of fully-qualified function paths (e.g.
 * "functions/devAssistant/bugs:getBug") that are missing from `internalApi` at
 * `functionsPath` — empty when the mount is wired correctly. Pure and
 * synchronous; no Convex ctx required, so it runs in a plain unit test.
 */
export function validateMount(
  internalApi: any,
  functionsPath: string,
): string[] {
  const missing: string[] = [];
  const check = (moduleName: string, fnNames: readonly string[]): void => {
    const mod = resolveModuleRoot(internalApi, `${functionsPath}/${moduleName}`);
    for (const fn of fnNames) {
      if (mod?.[fn] === undefined) {
        missing.push(`${functionsPath}/${moduleName}:${fn}`);
      }
    }
  };
  check("bugs", BUG_FUNCTIONS);
  check("actions", ACTION_FUNCTIONS);
  check("maintainers", MAINTAINER_FUNCTIONS);
  return missing;
}

/**
 * Same as `validateMount`, but throws a descriptive error listing every
 * missing function when the mount is wrong. Convenience for a one-line test
 * assertion — see the README "Smoke test" recipe.
 */
export function assertMounted(internalApi: any, functionsPath: string): void {
  const missing = validateMount(internalApi, functionsPath);
  if (missing.length > 0) {
    throw new Error(
      `createDevAssistant: functionsPath "${functionsPath}" does not resolve ` +
        `against the generated Convex API — re-export the missing function(s) ` +
        `at exactly the shown path(s):\n` +
        missing.map((m) => `  - ${m}`).join("\n"),
    );
  }
}
