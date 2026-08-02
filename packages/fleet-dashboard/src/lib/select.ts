/**
 * Snapshot → panels.
 *
 * Every view is a pure function of the snapshot plus the review timestamp.
 * Keeping the selection here rather than inside components means the rules that
 * decide "is this a question or a park?" are testable, and that the same issue
 * can honestly appear in two panels without a `kind` field having to pick one.
 */

import { isNoisyInitiative } from "./initiative";
import { indexInitiatives, type InitiativeEntry, type InitiativesManifest } from "./initiativesFile";
import { AGENTIC_WORKFLOWS_LABEL, AUTOMATION_AUTHORS, isManaged, LABELS } from "./labels";
import { findMarker, parseMarkers, type MarkerBlock } from "./markers";
import type { Initiative, IssueCard, PullRequestCard } from "../sources/types";

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

/* ── Initiatives, per app ───────────────────────────────────────────────── */

export interface InitiativeCardModel {
  name: string;
  /** The manifest entry, or `null` when the repo has none for this name. */
  entry: InitiativeEntry | null;
  issues: IssueCard[];
  prs: PullRequestCard[];
  /**
   * Nobody named this: no manifest entry and no `init:*` label, only a branch
   * prefix. Still a card — it survived the stoplist, so it looks like a project —
   * but the card says where it came from and asks to be written down.
   */
  inferred: boolean;
}

export interface AppInitiatives {
  live: InitiativeCardModel[];
  archived: InitiativeCardModel[];
  /**
   * Branch prefixes that are conventions or harness noise, folded into one row.
   *
   * A row rather than cards, and one rather than seven, because the answer to
   * "what is `chore`?" is "nothing" — and seven cards each saying that is the
   * junk this bucket exists to absorb.
   */
  misc: { prefixes: string[]; prs: PullRequestCard[] };
}

/** The minimum of a `ProjectSnapshot` this needs. Structural, to keep `lib/` light. */
export interface InitiativeSources {
  key: string;
  manifest: InitiativesManifest;
  initiatives: readonly Initiative[];
}

/**
 * One app's initiative cards, its archive, and its misc bucket.
 *
 * A card is a claim that a project exists, so only a human may make one: a
 * `.fleet/initiatives.json` entry, or an `init:*` label somebody applied. Branch
 * prefixes still contribute — that is how work is found before anyone writes it
 * down — but only after the stoplist has taken out the ones that are conventions
 * (`feat`, `chore`) or harness output (`claude`, `cursor`).
 */
export function selectAppInitiatives(
  issues: readonly IssueCard[],
  project: InitiativeSources,
): AppInitiatives {
  const manifest = indexInitiatives(project.manifest);
  const byLabel = selectByInitiative(issues, project.key);
  const byBranch = new Map(
    project.initiatives.map((initiative) => [initiative.name, initiative.prs]),
  );

  // Named by a human, either in the manifest or with a label.
  const named = new Set<string>([...manifest.keys(), ...byLabel.keys()]);
  const cards: InitiativeCardModel[] = [];
  const misc: AppInitiatives["misc"] = { prefixes: [], prs: [] };

  for (const name of new Set<string>([...named, ...byBranch.keys()])) {
    const prs = byBranch.get(name) ?? [];
    const inferred = !named.has(name);
    if (inferred && isNoisyInitiative(name)) {
      misc.prefixes.push(name);
      misc.prs.push(...prs);
      continue;
    }
    cards.push({
      name,
      entry: manifest.get(name) ?? null,
      issues: byLabel.get(name) ?? [],
      prs,
      inferred,
    });
  }

  cards.sort((a, b) => a.name.localeCompare(b.name));
  misc.prefixes.sort((a, b) => a.localeCompare(b));

  return {
    live: cards.filter((card) => card.entry?.archived !== true),
    archived: cards.filter((card) => card.entry?.archived === true),
    misc,
  };
}

/* ── Triage ─────────────────────────────────────────────────────────────── */

export interface Triage {
  /** Untriaged issues that look like product work — the list you act on. */
  work: IssueCard[];
  /**
   * Untriaged issues the automation filed about itself. Still shown, because an
   * invisible report is the same as no report, but folded away: queueing a
   * gardener's own weekly summary as agent work is not what anyone means.
   */
  automation: IssueCard[];
}

/** An issue the Actions bot filed about a gh-aw run, not about the product. */
function isAutomationReport(issue: IssueCard): boolean {
  const author = issue.author?.toLowerCase() ?? "";
  return (
    AUTOMATION_AUTHORS.includes(author) && issue.labels.includes(AGENTIC_WORKFLOWS_LABEL)
  );
}

/**
 * Open issues the fleet is not managing.
 *
 * Defined by label **absence**, which is why it lives here and not in the
 * GraphQL: the search can only exclude names it knows, and `init:*` is an open
 * set. The query narrows the bandwidth; this decides.
 *
 * Newest first — a triage list read top-down should start where the filing did.
 */
export function selectTriage(
  issues: readonly IssueCard[],
  repoKey: string | null = null,
): Triage {
  const triage: Triage = { work: [], automation: [] };
  for (const issue of issues) {
    if (repoKey !== null && issue.repoKey !== repoKey) continue;
    if (isManaged(issue.labels)) continue;
    if (isAutomationReport(issue)) triage.automation.push(issue);
    else triage.work.push(issue);
  }
  const newestFirst = (a: IssueCard, b: IssueCard) => b.createdAt.localeCompare(a.createdAt);
  triage.work.sort(newestFirst);
  triage.automation.sort(newestFirst);
  return triage;
}

/**
 * repoKey → untriaged **work** count, for the nav badges and the Review count.
 *
 * Automation reports are excluded on purpose. They are visible on the app view
 * in their own collapsed row; badging them too would put a permanent number
 * beside every app for something nobody is going to action, which is precisely
 * the noise a badge is supposed to cut through.
 */
export function countTriageByRepo(issues: readonly IssueCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of selectTriage(issues).work) {
    counts.set(issue.repoKey, (counts.get(issue.repoKey) ?? 0) + 1);
  }
  return counts;
}
