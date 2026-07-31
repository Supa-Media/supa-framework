import type { PrState } from "../sources/types";

/**
 * Collapse GitHub's several independent PR signals into the single state the
 * ACTIVE WORK row shows. Order matters — it is "what is this PR waiting on,
 * most blocking first", not a status bitfield.
 */
export interface PrSignals {
  isDraft: boolean;
  /** GraphQL `statusCheckRollup.state`, or null when the head commit has no checks. */
  checkState: "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | null;
  /** GraphQL `mergeable`. `CONFLICTING` means the branch needs a rebase. */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  /** GraphQL `reviewDecision`. */
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** Whether anyone still owes a review. */
  hasRequestedReviewers: boolean;
}

export function derivePrState(signals: PrSignals): PrState {
  if (signals.isDraft) return "draft";
  if (signals.checkState === "FAILURE" || signals.checkState === "ERROR") return "ci-failed";
  if (signals.checkState === "PENDING" || signals.checkState === "EXPECTED") return "ci-running";
  if (signals.mergeable === "CONFLICTING") return "conflict";
  if (
    signals.reviewDecision === "REVIEW_REQUIRED" ||
    signals.reviewDecision === "CHANGES_REQUESTED" ||
    signals.hasRequestedReviewers
  ) {
    return "review";
  }
  return "mergeable";
}

/**
 * Why a PR belongs in NEEDS YOU, or `null` when nobody is blocked on a human.
 *
 * Two ways in, per the wireframe: the fleet owner is an explicitly requested
 * reviewer, or a required (codeowner) review is missing — which GitHub reports
 * as `reviewDecision: REVIEW_REQUIRED` on a non-draft PR.
 */
export function needsYouReason(
  signals: PrSignals,
  requestedReviewers: readonly string[],
  owner: string,
): string | null {
  if (signals.isDraft) return null;

  const ownerRequested = requestedReviewers.some(
    (login) => login.toLowerCase() === owner.toLowerCase(),
  );
  if (ownerRequested) return `review requested from ${owner}`;

  if (signals.reviewDecision === "REVIEW_REQUIRED") return "required review missing";
  if (signals.reviewDecision === "CHANGES_REQUESTED") return "changes requested";

  return null;
}
