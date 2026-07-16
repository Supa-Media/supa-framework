import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMount, assertMounted } from "../src/functions/validateMount";

/**
 * A stand-in for a consumer's generated `internal` object, correctly wired at
 * "functions/devAssistant" — mirrors what `convex codegen` would produce once
 * `bugs.ts`/`actions.ts`/`maintainers.ts` re-export everything the README's
 * mounting guide lists.
 */
function wiredInternalApi(): any {
  const stub = () => ({});
  return {
    functions: {
      devAssistant: {
        bugs: {
          getBug: stub(),
          getBugByRoutineRunId: stub(),
          getOriginatorAttribution: stub(),
          getThreadHistory: stub(),
          listOpenPrBugs: stub(),
          applyCallback: stub(),
          markDispatched: stub(),
          markSpecDispatched: stub(),
          markReviewDispatched: stub(),
          markFixDispatched: stub(),
          setGithubIssue: stub(),
          recordDispatchError: stub(),
          addSystemThreadMessage: stub(),
          recordProductionDeployOutcome: stub(),
          recordMergeFromAppFailure: stub(),
          handleGithubPrClosed: stub(),
          handleWorkflowRunEvent: stub(),
        },
        actions: {
          dispatchBug: stub(),
          dispatchSpec: stub(),
          dispatchReview: stub(),
          dispatchFix: stub(),
          attemptAutoMerge: stub(),
          mergeFromApp: stub(),
          retryMergeAfterUpdate: stub(),
          dispatchProductionDeploy: stub(),
          reconcileMergedPrs: stub(),
          handleRoutineCallback: stub(),
        },
        maintainers: {
          getAutoMergeCapForUser: stub(),
        },
      },
    },
  };
}

test("validateMount returns [] for a correctly wired functionsPath", () => {
  const missing = validateMount(wiredInternalApi(), "functions/devAssistant");
  assert.deepEqual(missing, []);
});

test("assertMounted does not throw for a correctly wired functionsPath", () => {
  assert.doesNotThrow(() =>
    assertMounted(wiredInternalApi(), "functions/devAssistant"),
  );
});

test("validateMount reports every missing function when the whole module is absent (wrong functionsPath)", () => {
  const missing = validateMount(wiredInternalApi(), "functions/wrongPath");
  // 17 bugs + 10 actions + 1 maintainers.
  assert.equal(missing.length, 28);
  assert.ok(missing.includes("functions/wrongPath/bugs:getBug"));
  assert.ok(missing.includes("functions/wrongPath/actions:dispatchBug"));
  assert.ok(missing.includes("functions/wrongPath/maintainers:getAutoMergeCapForUser"));
});

test("validateMount reports a single missing export when only one re-export was dropped", () => {
  const api = wiredInternalApi();
  delete api.functions.devAssistant.actions.reconcileMergedPrs;
  const missing = validateMount(api, "functions/devAssistant");
  assert.deepEqual(missing, ["functions/devAssistant/actions:reconcileMergedPrs"]);
});

test("assertMounted throws a descriptive error listing the missing function(s)", () => {
  const api = wiredInternalApi();
  delete api.functions.devAssistant.bugs.applyCallback;
  assert.throws(
    () => assertMounted(api, "functions/devAssistant"),
    /functions\/devAssistant\/bugs:applyCallback/,
  );
});
