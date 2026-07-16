/**
 * Dev-Assistant status machine — the monotonic bug lifecycle.
 *
 * Ported verbatim (semantics unchanged) from Togather's
 * `apps/convex/functions/devAssistant/bugs.ts` (ADR-029). This module is PURE —
 * no Convex, no ctx — so the transition rules are unit-testable in isolation and
 * shared by the DB-op mutations, the callback handler, and the HTTP layer.
 *
 * The lifecycle is MONOTONIC: a bug only ever moves forward (plus REJECTED from
 * any non-terminal state), which is deliberate:
 *
 *  - Stale/reordered routine callbacks can't corrupt state. If an older
 *    CODE_REVIEW callback is replayed after the bug reached READY_TO_MERGE, the
 *    backward transition is illegal and `applyCallback` ignores it.
 *  - Each status is reached at most once, so a `bug:<id>:<status>` idempotency
 *    key is genuinely unique per lifecycle.
 *
 * The one deliberate cycle is MERGED -> READY_FOR_IMPL: the staging-redo loop
 * (`reportStagingIssue`). It is human-triggered only (never reachable from a
 * callback), so stale-callback protection is unaffected.
 */

export const BUG_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "READY_FOR_IMPL",
  "IN_PROGRESS",
  "CODE_REVIEW",
  "READY_TO_MERGE",
  "MERGED",
  "REJECTED",
] as const;

export type BugStatus = (typeof BUG_STATUSES)[number];

/** AI-proposed blast-radius level for dashboard contributions (ADR-029). */
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** AI-proposed scope classification for dashboard contributions (ADR-029 P1.5). */
export const SCOPES = ["buildable", "split", "design_needed"] as const;
export type Scope = (typeof SCOPES)[number];

/** Verdict reported by the review-mode routine after reviewing an open PR. */
export const REVIEW_VERDICTS = ["approved", "changes_requested"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/**
 * Where a callback came from. Internal-only — threaded by trusted callers
 * (routine callback → "routine", GitHub webhook → "webhook", auto-merge →
 * "automerge") and NEVER exposed through the public HTTP callback, which always
 * lands as the least-trusted "routine" source.
 */
export const CALLBACK_SOURCES = ["routine", "webhook", "automerge"] as const;
export type CallbackSource = (typeof CALLBACK_SOURCES)[number];

/**
 * Valid forward transitions. See the module doc comment for the invariants.
 *
 * CODE_REVIEW -> MERGED is a legal forward skip: a maintainer can merge the PR
 * directly on GitHub before the AI review verdict lands, and the GitHub webhook
 * reports that merge. Still monotonic. MERGED is only reachable via
 * webhook/auto-merge sources (or the human `markBugMerged`) — `applyCallback`
 * rejects routine-claimed merges.
 *
 * MERGED -> READY_FOR_IMPL is the staging-redo loop, human-triggered only.
 */
export const ALLOWED_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  DRAFT: ["IN_REVIEW", "REJECTED"],
  IN_REVIEW: ["READY_FOR_IMPL", "REJECTED"],
  READY_FOR_IMPL: ["IN_PROGRESS", "REJECTED"],
  IN_PROGRESS: ["CODE_REVIEW", "REJECTED"],
  CODE_REVIEW: ["READY_TO_MERGE", "MERGED", "REJECTED"],
  READY_TO_MERGE: ["MERGED", "REJECTED"],
  MERGED: ["READY_FOR_IMPL"],
  REJECTED: [],
};

export function canTransition(from: BugStatus, to: BugStatus): boolean {
  if (from === to) return true; // idempotent re-apply
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Statuses a GitHub-observed merge (webhook / auto-merge sources) may arrive
 * from. GitHub is ground truth for merges, so this deliberately includes
 * IN_PROGRESS — a PR merged on GitHub before the implementation callback landed
 * would otherwise strand the row — plus MERGED for idempotent redeliveries.
 * Routine-claimed merges are rejected outright instead.
 */
export const GITHUB_MERGEABLE_STATUSES: BugStatus[] = [
  "IN_PROGRESS",
  "CODE_REVIEW",
  "READY_TO_MERGE",
  "MERGED",
];

/**
 * Whether a `targetStatus` may be applied from `currentStatus` given the
 * callback `source`. Webhook/auto-merge merges may arrive from any PR-live
 * state (GitHub is ground truth); everything else follows the monotonic map.
 * Pure — the caller decides `targetStatus` (e.g. an approved review verdict on
 * CODE_REVIEW promotes to READY_TO_MERGE before calling this).
 */
export function isTransitionAllowed(
  currentStatus: BugStatus,
  targetStatus: BugStatus,
  source: CallbackSource,
): boolean {
  if (targetStatus === "MERGED" && source !== "routine") {
    return GITHUB_MERGEABLE_STATUSES.includes(currentStatus);
  }
  return canTransition(currentStatus, targetStatus);
}
