/**
 * Plain-language copy + budget constants for the pipeline. PURE (no ctx) and
 * ported verbatim from Togather's devAssistant so the wording — and the merge
 * failure diagnosis — stays consistent. Domain-neutral: the church/community
 * area labels live in config (`DevAssistantConfig.areas`), not here.
 */

import type { BugStatus } from "./statusMachine";

/** Fix-round budget: auto-fix dispatches per bug before escalating to a human. */
export const DEFAULT_MAX_FIX_ROUNDS = 3;

/** Max characters of a reviewSummary quoted in the thread's system message. */
export const REVIEW_SUMMARY_THREAD_LIMIT = 200;

/** Longest title derived from a chat-first message before the AI titles it. */
export const DERIVED_TITLE_MAX = 80;

/** Default production re-trigger cooldown (15 min) — see promoteToProduction. */
export const DEFAULT_PRODUCTION_RETRIGGER_COOLDOWN_MS = 15 * 60 * 1000;

/** Bounded recovery poll budget for the smarter in-app merge button. */
export const MERGE_RECOVERY_MAX_POLLS = 6;

/**
 * One-line system messages posted into the thread when a callback-applied
 * transition lands, so the conversation reads as a running progress log.
 */
export const STATUS_SYSTEM_MESSAGES: Partial<Record<BugStatus, string>> = {
  IN_PROGRESS: "Build started",
  CODE_REVIEW: "Pull request opened",
  READY_TO_MERGE: "Ready to merge",
  MERGED: "Merged — deploying to staging…",
};

/** System thread line posted the moment a merge is observed. */
export const MERGED_DEPLOYING_MESSAGE = "Merged — deploying to staging…";

/** System thread line posted once the staging deploy actually goes live. */
export const STAGING_LIVE_MESSAGE = "Live on staging — ready to try it";

/** Thread message posted when a PR is closed on GitHub without merging. */
export const PR_CLOSED_UNMERGED_MESSAGE =
  "Pull request closed without merging — needs a maintainer look";

/** Progress line posted when the in-app merge auto-updates a behind branch. */
export const MERGE_BEHIND_RECOVERING_MESSAGE =
  "Your branch was behind main — I've updated it and CI is re-running. I'll merge automatically once checks pass.";

export function fixRoundsExhaustedMessage(maxFixRounds: number): string {
  return `Code review still failing after ${maxFixRounds} fix rounds — needs a human`;
}

/**
 * Turn a free-form message into a one-line placeholder title (chat-first filing
 * has no title field). First non-empty line, trimmed and clipped.
 */
export function deriveTitle(body: string): string {
  const firstLine =
    body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? body.trim();
  return firstLine.length > DERIVED_TITLE_MAX
    ? `${firstLine.slice(0, DERIVED_TITLE_MAX - 1).trimEnd()}…`
    : firstLine;
}

/**
 * Turn a merge-block diagnosis into a plain-language thread message a non-coder
 * can act on — replacing GitHub's raw "merge returned 405 (…)" text.
 */
export function describeMergeBlock(
  kind: "conflict" | "failing" | "permission" | "unknown",
): string {
  switch (kind) {
    case "conflict":
      return "This PR conflicts with the base branch and needs code changes before it can merge.";
    case "failing":
      return "A required check on this PR is failing — it needs a code fix before it can merge.";
    case "permission":
      return "I couldn't update the branch — the merge bot may be missing repo access. A maintainer needs to check its permissions.";
    case "unknown":
      return "GitHub couldn't merge this PR — a maintainer may need to check it on GitHub.";
  }
}

/** Default status → chat message used when a callback carries no `message`. */
export function defaultCallbackMessage(
  status: string,
  prUrl: string | undefined,
): string {
  switch (status) {
    case "CODE_REVIEW":
      return prUrl
        ? `🛠️ Code's up and the review cycle is running.\nPR: ${prUrl}`
        : "🛠️ Code's up and the review cycle is running.";
    case "READY_TO_MERGE":
      return prUrl
        ? `🚀 This is ready to merge.\nMerge it here: ${prUrl}`
        : "🚀 This is ready to merge.";
    case "MERGED":
      return "🎉 Merged. Thanks!";
    case "REJECTED":
      return "This bug was rejected.";
    default:
      return `Status update: ${status}`;
  }
}
