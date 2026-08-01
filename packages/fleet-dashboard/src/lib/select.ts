/**
 * Snapshot → panels.
 *
 * Every view is a pure function of the snapshot plus the review timestamp.
 * Keeping the selection here rather than inside components means the rules that
 * decide "is this a question or a park?" are testable, and that the same issue
 * can honestly appear in two panels without a `kind` field having to pick one.
 */

import { LABELS } from "./labels";
import { findMarker, parseMarkers, type MarkerBlock } from "./markers";
import type { IssueCard } from "../sources/types";

export const MARKER_DECIDER = "decider";
export const MARKER_CONTEXT_SHEET = "context-sheet";
export const MARKER_QUESTION = "question";

export interface Decision {
  issue: IssueCard;
  block: MarkerBlock;
  /** The comment the marker was written in. */
  commentUrl: string;
  /** ISO-8601. */
  at: string;
}

export interface ParkedItem {
  issue: IssueCard;
  /** The context sheet, or `null` when the watchdog parked without writing one. */
  sheet: MarkerBlock | null;
  /** Where the sheet was written, for "open the comment". */
  sheetUrl: string | null;
}

export interface BatchedQuestion {
  issue: IssueCard;
  block: MarkerBlock;
  commentUrl: string;
  at: string;
}

export interface RepoGroup {
  repoKey: string;
  repoSlug: string;
  repoLabel: string;
  issues: IssueCard[];
}

function group(issues: readonly IssueCard[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();
  for (const issue of issues) {
    const existing = groups.get(issue.repoKey);
    if (existing) existing.issues.push(issue);
    else
      groups.set(issue.repoKey, {
        repoKey: issue.repoKey,
        repoSlug: issue.repoSlug,
        repoLabel: issue.repoLabel,
        issues: [issue],
      });
  }
  return [...groups.values()].sort((a, b) => a.repoLabel.localeCompare(b.repoLabel));
}

const has = (issue: IssueCard, label: string) => issue.labels.includes(label);

/**
 * Decisions an agent made while you were away.
 *
 * Scoped to comments written *after* the last review, because the panel's
 * promise is "here is what changed since you last looked" — a decider comment
 * you already kept last night must not reappear as an open question this
 * morning. The issue can be any the dashboard fetched: a decision is often
 * recorded on the very issue it unblocked, which is by then `agent:ready`
 * again rather than blocked.
 */
export function selectDecisions(issues: readonly IssueCard[], since: string): Decision[] {
  const decisions: Decision[] = [];
  for (const issue of issues) {
    for (const comment of issue.comments) {
      if (comment.createdAt <= since) continue;
      for (const block of parseMarkers(comment.body)) {
        if (block.marker !== MARKER_DECIDER) continue;
        decisions.push({ issue, block, commentUrl: comment.url, at: comment.createdAt });
      }
    }
  }
  return decisions.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Parked work: `agent:blocked`, with its context sheet pulled inline.
 *
 * The sheet is looked up newest-first because a re-park writes a second sheet,
 * and the older one describes a wall the agent has since climbed.
 */
export function selectParked(issues: readonly IssueCard[]): ParkedItem[] {
  return issues
    .filter((issue) => has(issue, LABELS.blocked))
    .map((issue) => {
      for (let i = issue.comments.length - 1; i >= 0; i -= 1) {
        const comment = issue.comments[i];
        if (comment === undefined) continue;
        const sheet = findMarker(comment.body, MARKER_CONTEXT_SHEET);
        if (sheet !== null) return { issue, sheet, sheetUrl: comment.url };
      }
      // The issue body itself is a legitimate place for the sheet — a watchdog
      // that parks an item it also filed writes one document, not two.
      const inBody = findMarker(issue.body, MARKER_CONTEXT_SHEET);
      return { issue, sheet: inBody, sheetUrl: inBody === null ? null : issue.url };
    })
    .sort((a, b) => a.issue.updatedAt.localeCompare(b.issue.updatedAt));
}

/**
 * Questions batched for this review.
 *
 * A question lives inside a park: an agent that needs an answer stops, and the
 * watchdog's sheet carries the question. Scanning unblocked issues too would
 * surface questions from agents that already answered themselves and moved on.
 */
export function selectQuestions(issues: readonly IssueCard[]): BatchedQuestion[] {
  const questions: BatchedQuestion[] = [];
  for (const issue of issues) {
    if (!has(issue, LABELS.blocked)) continue;

    // Newest first, and only the newest question per issue: an agent that asked
    // twice is asking about the same wall, and two buttons rows for one issue
    // is exactly the noise this screen exists to remove.
    let found = false;
    for (let i = issue.comments.length - 1; i >= 0 && !found; i -= 1) {
      const comment = issue.comments[i];
      if (comment === undefined) continue;
      const block = findMarker(comment.body, MARKER_QUESTION);
      if (block === null) continue;
      questions.push({ issue, block, commentUrl: comment.url, at: comment.createdAt });
      found = true;
    }
    if (found) continue;

    const inBody = findMarker(issue.body, MARKER_QUESTION);
    if (inBody !== null) {
      questions.push({ issue, block: inBody, commentUrl: issue.url, at: issue.createdAt });
    }
  }
  return questions.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Today's plan: `agent:ready` work, per app, awaiting your approval.
 *
 * Already-approved items are excluded — they are in the queue, and offering to
 * approve them again would make the button lie about what it does.
 */
export function selectPlan(issues: readonly IssueCard[]): RepoGroup[] {
  return group(issues.filter((issue) => has(issue, LABELS.ready) && !issue.planApproved));
}

/** The queue: approved work, plus anything ready that was approved earlier. */
export function selectQueue(issues: readonly IssueCard[]): RepoGroup[] {
  return group(
    issues.filter((issue) => issue.planApproved && !has(issue, LABELS.inProgress)),
  );
}

/** ◉ Now: what an agent has its hands on right this second. */
export function selectInProgress(issues: readonly IssueCard[]): RepoGroup[] {
  return group(issues.filter((issue) => has(issue, LABELS.inProgress)));
}

/** 📥 Inbox: extracted proposals awaiting keep/reject. */
export function selectProposed(issues: readonly IssueCard[]): IssueCard[] {
  return issues.filter((issue) => has(issue, LABELS.inboxProposed));
}

/** 📥 Inbox: raw dumps waiting for the extraction pipeline. */
export function selectRawDumps(issues: readonly IssueCard[]): IssueCard[] {
  return issues.filter((issue) => has(issue, LABELS.inboxRaw));
}

/** 🐕 Watchdog: the intervention log. */
export function selectWatchdogReports(issues: readonly IssueCard[]): IssueCard[] {
  return issues.filter((issue) => has(issue, LABELS.watchdogReport));
}

/** Issues that name an initiative, for the Apps view's cards. */
export function selectByInitiative(
  issues: readonly IssueCard[],
  repoKey: string,
): Map<string, IssueCard[]> {
  const byName = new Map<string, IssueCard[]>();
  for (const issue of issues) {
    if (issue.repoKey !== repoKey) continue;
    for (const name of issue.initiatives) {
      const bucket = byName.get(name);
      if (bucket) bucket.push(issue);
      else byName.set(name, [issue]);
    }
  }
  return byName;
}
