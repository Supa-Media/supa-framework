/**
 * Internal function references for event-driven scheduling.
 *
 * The package's mutations/actions schedule each other (READY_FOR_IMPL →
 * dispatchBug, CODE_REVIEW → dispatchReview, changes_requested → dispatchFix,
 * …). A framework package can't import the consumer's generated `internal`
 * namespace, so we build the references from the configured `functionsPath`
 * with `makeFunctionReference` — the consumer must re-export the returned
 * functions at exactly `${functionsPath}/{bugs,actions,maintainers}` for these
 * to resolve. This replaces Togather's `internal.functions.devAssistant.*`.
 */

import { makeFunctionReference, type FunctionReference } from "convex/server";

/**
 * A function reference of unconstrained type — these are only ever consumed via
 * the (untyped) generic ctx's `scheduler.runAfter` / `runMutation` / `runQuery`
 * / `runAction`, so precise arg/return typing here would add no safety.
 */
type AnyRef = FunctionReference<any, any, any, any>;

export interface DevAssistantRefs {
  bugs: {
    getBug: AnyRef;
    getBugByRoutineRunId: AnyRef;
    getOriginatorAttribution: AnyRef;
    getThreadHistory: AnyRef;
    listOpenPrBugs: AnyRef;
    applyCallback: AnyRef;
    markDispatched: AnyRef;
    markSpecDispatched: AnyRef;
    markReviewDispatched: AnyRef;
    markFixDispatched: AnyRef;
    setGithubIssue: AnyRef;
    recordDispatchError: AnyRef;
    addSystemThreadMessage: AnyRef;
    recordProductionDeployOutcome: AnyRef;
    recordMergeFromAppFailure: AnyRef;
    handleGithubPrClosed: AnyRef;
    handleWorkflowRunEvent: AnyRef;
  };
  actions: {
    dispatchBug: AnyRef;
    dispatchSpec: AnyRef;
    dispatchReview: AnyRef;
    dispatchFix: AnyRef;
    attemptAutoMerge: AnyRef;
    mergeFromApp: AnyRef;
    retryMergeAfterUpdate: AnyRef;
    dispatchProductionDeploy: AnyRef;
    reconcileMergedPrs: AnyRef;
    handleRoutineCallback: AnyRef;
  };
  maintainers: {
    getAutoMergeCapForUser: AnyRef;
  };
}

const ref = (path: string): AnyRef =>
  makeFunctionReference<any>(path) as AnyRef;

export function makeRefs(functionsPath: string): DevAssistantRefs {
  const bugs = `${functionsPath}/bugs`;
  const actions = `${functionsPath}/actions`;
  const maintainers = `${functionsPath}/maintainers`;
  return {
    bugs: {
      getBug: ref(`${bugs}:getBug`),
      getBugByRoutineRunId: ref(`${bugs}:getBugByRoutineRunId`),
      getOriginatorAttribution: ref(`${bugs}:getOriginatorAttribution`),
      getThreadHistory: ref(`${bugs}:getThreadHistory`),
      listOpenPrBugs: ref(`${bugs}:listOpenPrBugs`),
      applyCallback: ref(`${bugs}:applyCallback`),
      markDispatched: ref(`${bugs}:markDispatched`),
      markSpecDispatched: ref(`${bugs}:markSpecDispatched`),
      markReviewDispatched: ref(`${bugs}:markReviewDispatched`),
      markFixDispatched: ref(`${bugs}:markFixDispatched`),
      setGithubIssue: ref(`${bugs}:setGithubIssue`),
      recordDispatchError: ref(`${bugs}:recordDispatchError`),
      addSystemThreadMessage: ref(`${bugs}:addSystemThreadMessage`),
      recordProductionDeployOutcome: ref(`${bugs}:recordProductionDeployOutcome`),
      recordMergeFromAppFailure: ref(`${bugs}:recordMergeFromAppFailure`),
      handleGithubPrClosed: ref(`${bugs}:handleGithubPrClosed`),
      handleWorkflowRunEvent: ref(`${bugs}:handleWorkflowRunEvent`),
    },
    actions: {
      dispatchBug: ref(`${actions}:dispatchBug`),
      dispatchSpec: ref(`${actions}:dispatchSpec`),
      dispatchReview: ref(`${actions}:dispatchReview`),
      dispatchFix: ref(`${actions}:dispatchFix`),
      attemptAutoMerge: ref(`${actions}:attemptAutoMerge`),
      mergeFromApp: ref(`${actions}:mergeFromApp`),
      retryMergeAfterUpdate: ref(`${actions}:retryMergeAfterUpdate`),
      dispatchProductionDeploy: ref(`${actions}:dispatchProductionDeploy`),
      reconcileMergedPrs: ref(`${actions}:reconcileMergedPrs`),
      handleRoutineCallback: ref(`${actions}:handleRoutineCallback`),
    },
    maintainers: {
      getAutoMergeCapForUser: ref(`${maintainers}:getAutoMergeCapForUser`),
    },
  };
}
