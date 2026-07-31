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
 *
 * `author` exists because `REVIEW_REQUIRED` comes back for **any** PR under a
 * branch-protection rule requiring approvals — including ones the owner opened
 * himself. GitHub forbids self-review, so those rows would be structurally
 * un-actionable in a panel whose whole premise is "what is blocked on *you*".
 * In a fleet where most PRs are agent-authored on the owner's behalf, that
 * would be most of the list the day protection is switched on. An explicit
 * review request still counts: GitHub won't create one for your own PR.
 */
export function needsYouReason(
  signals: PrSignals,
  requestedReviewers: readonly string[],
  owner: string,
  author: string | null,
): string | null {
  if (signals.isDraft) return null;

  const isOwner = (login: string) => login.toLowerCase() === owner.toLowerCase();

  if (requestedReviewers.some(isOwner)) return `review requested from ${owner}`;

  if (author !== null && isOwner(author)) return null;

  if (signals.reviewDecision === "REVIEW_REQUIRED") return "required review missing";
  if (signals.reviewDecision === "CHANGES_REQUESTED") return "changes requested";

  return null;
}
