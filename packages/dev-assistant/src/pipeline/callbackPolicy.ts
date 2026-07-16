/**
 * Per-run-mode callback policy — the rules governing what a Routine callback
 * may deliver, decided by (1) the callback `source` and (2) the `activeRunMode`
 * stamped on the bug at dispatch (ADR-029 Phase 1.6).
 *
 * Extracted PURE from Togather's `applyCallback` (bugs.ts) so the policy table
 * is unit-testable on its own. `applyCallback` calls {@link checkCallbackPolicy}
 * and rejects (records `lastError`, persists nothing else) on a non-null result.
 *
 *    | mode      | statuses allowed          | reviewVerdict                |
 *    | --------- | ------------------------- | ---------------------------- |
 *    | spec      | IN_REVIEW                 | rejected                     |
 *    | implement | IN_PROGRESS, CODE_REVIEW  | rejected                     |
 *    | review    | CODE_REVIEW               | honored (approved promotes   |
 *    |           |                           | to READY_TO_MERGE)           |
 *    | fix       | CODE_REVIEW               | IGNORED (stripped, no error) |
 *    | (unset)   | legacy permissive         | honored                      |
 *
 * READY_TO_MERGE from an implement run is rejected explicitly — the review
 * pipeline owns that promotion. Unset mode covers rows dispatched before
 * stamping existed and keeps their old behavior. MERGED is webhook/auto-merge
 * only regardless of mode (checked separately in `applyCallback`).
 */

import type { BugStatus, CallbackSource, ReviewVerdict } from "./statusMachine";

export const RUN_MODES = ["spec", "implement", "review", "fix"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface CallbackPolicyInput {
  source: CallbackSource;
  /** The run mode stamped on the bug (undefined = legacy pre-stamping row). */
  mode: RunMode | undefined;
  status: BugStatus;
  reviewVerdict?: ReviewVerdict;
}

/**
 * Returns a rejection reason string when the callback is out of policy, or
 * `null` when it is allowed. Only routine-source callbacks with a stamped mode
 * are policed here — webhook/auto-merge sources and legacy (unset-mode) rows
 * pass (their MERGED gate lives in `applyCallback`/`isTransitionAllowed`).
 */
export function checkCallbackPolicy(input: CallbackPolicyInput): string | null {
  const { source, mode, status, reviewVerdict } = input;
  if (source !== "routine" || mode === undefined) return null;

  if (mode === "spec") {
    if (status !== "IN_REVIEW") {
      return `spec run may not deliver status ${status}`;
    }
    if (reviewVerdict !== undefined) {
      return "spec run may not deliver a review verdict";
    }
  } else if (mode === "implement") {
    if (status === "READY_TO_MERGE") {
      return "implement run may not deliver READY_TO_MERGE — the review pipeline owns that promotion";
    }
    if (status !== "IN_PROGRESS" && status !== "CODE_REVIEW") {
      return `implement run may not deliver status ${status}`;
    }
    if (reviewVerdict !== undefined) {
      return "implement run may not deliver a review verdict";
    }
  } else if (mode === "review" && status !== "CODE_REVIEW") {
    return `review run may not deliver status ${status}`;
  } else if (mode === "fix" && status !== "CODE_REVIEW") {
    return `fix run may not deliver status ${status}`;
  }
  return null;
}

/**
 * A fix run has no review authority: a verdict in its callback (e.g. the run
 * echoing the feedback it just addressed) is IGNORED, never stored. True when
 * the run mode + source mean any echoed verdict must be stripped.
 */
export function shouldIgnoreVerdict(
  source: CallbackSource,
  mode: RunMode | undefined,
): boolean {
  return source === "routine" && mode === "fix";
}
