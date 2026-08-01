/**
 * The fleet-dashboard data contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ADAPTER SEAM — read this before adding another data source.
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything the UI renders comes from a `FleetSource`. v2 still ships exactly
 * one implementation (`sources/github/githubSource.ts`, REST + GraphQL against
 * api.github.com with a user-supplied PAT).
 *
 * A future source — most likely a `@supa-media/dev-assistant` Convex source that
 * knows about contributions/bugs the GitHub API can't see — implements this
 * same interface and gets merged into the snapshot. Rules for that seam:
 *
 *   1. A source returns a `FleetSnapshot`; it never touches the DOM and never
 *      reads config other than what's handed to `createXSource(...)`.
 *   2. A source MUST NOT throw for a partial failure. Push a `SourceError` onto
 *      `snapshot.errors` and return whatever else succeeded — the dashboard is
 *      a status board, and one dead repo must not blank the page.
 *   3. Merging is by `ProjectSnapshot.key`. When two sources describe the same
 *      project, the later source in `fleet.config.ts`'s source list wins for
 *      scalar fields and appends to list fields.
 *
 * Writes are a separate seam (`FleetWriter`, below) so a read-only deployment
 * can simply not construct one.
 *
 * Nothing in this file may import React or the GitHub client.
 */

import type { EngineConfig, GardenerCaps } from "../lib/engine";
import type { Allowlist } from "../lib/allowlist";
import type { Evidence } from "../lib/evidence";
import type { InitiativesManifest } from "../lib/initiativesFile";

/** How a pull request is blocking, as shown in the ◉ Now rows. */
export type PrState =
  | "draft"
  | "ci-running"
  | "ci-failed"
  | "conflict"
  | "review"
  | "mergeable";

/** Normalized state of a CI / deploy / gardener run. */
export type RunState = "success" | "failure" | "running" | "cancelled" | "unknown";

export interface RunSummary {
  /** Display name of the workflow that produced the run. */
  name: string;
  state: RunState;
  /** ISO-8601. When the run finished, or started if it is still going. */
  at: string;
  url: string;
}

export interface PullRequestCard {
  /** Stable across refreshes: `owner/name#number`. */
  id: string;
  repoKey: string;
  repoLabel: string;
  number: number;
  title: string;
  url: string;
  branch: string;
  /** Branch prefix — see `lib/initiative.ts`. */
  initiative: string;
  state: PrState;
  isDraft: boolean;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** Logins of users/teams with an outstanding review request. */
  requestedReviewers: string[];
  /**
   * Why this PR is in NEEDS YOU, or `null` when it isn't waiting on a human.
   * e.g. "review requested from lilseyi", "CI failed".
   */
  needsYouReason: string | null;
}

/** A PR merged inside the review window — one row of "shipped since your last review". */
export interface ShippedPr {
  id: string;
  repoKey: string;
  repoLabel: string;
  number: number;
  title: string;
  url: string;
  /** ISO-8601. */
  mergedAt: string;
  author: string | null;
  /** Chips parsed from the body's `## Evidence` section. */
  evidence: Evidence;
}

export interface IssueComment {
  url: string;
  body: string;
  /** ISO-8601. */
  createdAt: string;
  author: string | null;
}

/**
 * Every issue the dashboard cares about, in one shape.
 *
 * Which panel an issue lands in is a function of its labels, computed in the
 * views rather than baked in here — an issue can legitimately be both
 * `agent:ready` and `plan:approved`, and a single `kind` field would have to
 * pick a winner.
 */
export interface IssueCard {
  /** `owner/name#number`. */
  id: string;
  /** GraphQL node id — needed for the batched label mutation. */
  nodeId: string;
  repoKey: string;
  repoSlug: string;
  repoLabel: string;
  number: number;
  title: string;
  url: string;
  body: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  labels: string[];
  /** `init:*` labels, prefix stripped. */
  initiatives: string[];
  /** `size:*` label value, uppercased, or null. */
  size: string | null;
  automerge: boolean;
  notify: boolean;
  planApproved: boolean;
  /** Newest-last. Capped — see `MAX_ISSUE_COMMENTS`. */
  comments: IssueComment[];
}

export interface Initiative {
  /** Branch prefix, or `misc` for branches with no prefix. */
  name: string;
  prs: PullRequestCard[];
}

export type { GardenerCaps };

export interface Gardener {
  repoKey: string;
  repoSlug: string;
  repoLabel: string;
  /** Human name, derived from the workflow file or its `name:` field. */
  name: string;
  /** e.g. `.github/workflows/gardener-triage.lock.yml`. */
  workflowPath: string;
  /** The gh-aw markdown source, e.g. `.github/workflows/gardener-triage.md`. */
  sourcePath: string;
  /** Deep link to GitHub's web editor for `sourcePath`. */
  editUrl: string;
  /**
   * Agent engine + model from the gh-aw source frontmatter, e.g.
   * `{ id: "custom", model: "qwen3-coder:480b" }`. Nulls when undeclared.
   */
  engine: EngineConfig;
  /** Spend and turn ceilings declared in the frontmatter. */
  caps: GardenerCaps;
  /**
   * The markdown body below the frontmatter — the actual instructions the model
   * receives. Shown read-only; editing is a deep link, never an API write.
   */
  prompt: string;
  /**
   * Every 5-field cron on the workflow. A workflow may declare several; an
   * empty array means it is manual / event-driven.
   */
  crons: string[];
  /** Human-readable rendering of `crons`, e.g. "Mondays at 09:00 UTC". */
  schedule: string;
  /** ISO-8601 of the soonest next fire across `crons`, or `null`. */
  nextRunAt: string | null;
  lastRun: RunSummary | null;
  /**
   * USD for this workflow as stated by the most recent cost report, or `null`
   * when no report was found. NOT month-to-date: the gh-aw report is weekly and
   * nothing here does month arithmetic, so the field is named for what it is.
   */
  costReportedUsd: number | null;
}

export interface ProjectSnapshot {
  /** `owner/name`, lowercased. The merge key across sources. */
  key: string;
  /** `owner/name` with GitHub's own casing — what API paths need. */
  slug: string;
  label: string;
  url: string;
  defaultBranch: string;
  /** Workflow runs currently queued or in progress. */
  activeRuns: number;
  /** Exact count from GitHub's search `issueCount` — never a length of nodes. */
  openPrs: number;
  /**
   * How many PRs were actually fetched. Lower than `openPrs` only when a repo
   * exceeds the pagination cap, which the UI must then say out loud rather
   * than render a short list as if it were complete.
   */
  fetchedPrs: number;
  /** Latest run on the default branch, whatever workflow it was. */
  ci: RunSummary | null;
  /** Latest *successful* run of any workflow named in the repo's `deployWorkflows`. */
  lastDeploy: RunSummary | null;
  /** Latest *successful* run of the repo's production workflow specifically. */
  lastProdDeploy: RunSummary | null;
  initiatives: Initiative[];
  gardeners: Gardener[];
  /** `.fleet/initiatives.json`, or an empty manifest when the repo has none. */
  manifest: InitiativesManifest;
  /** The repo's 1Password → GitHub secrets allowlist. */
  allowlist: Allowlist;
  /**
   * GitHub Actions secret *names* (never values), or `null` when the token
   * lacks the admin scope the endpoint requires. `null` means unknown, which
   * the Secrets matrix renders differently from "absent".
   */
  secretNames: string[] | null;
}

export interface SourceError {
  /** `owner/name` when the failure is repo-scoped, else the source id. */
  scope: string;
  message: string;
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  /** ISO-8601. */
  resetAt: string;
}

export interface FleetSnapshot {
  /** ISO-8601 of when this snapshot was assembled. */
  fetchedAt: string;
  /** ISO-8601 the `shipped` list was fetched relative to. */
  since: string;
  projects: ProjectSnapshot[];
  /** PRs across every project that are blocked on a human. */
  needsYou: PullRequestCard[];
  /** PRs merged since `since`, newest first. */
  shipped: ShippedPr[];
  /** Every issue carrying a label the dashboard reads, across the fleet. */
  issues: IssueCard[];
  /**
   * Total spend across the fleet's most recent cost reports, or `null` when
   * unknown. Deliberately not called month-to-date — see `costReportedUsd`.
   */
  spendReportedUsd: number | null;
  /** ISO-8601 of the newest cost report seen, so staleness is visible. */
  spendReportedAt: string | null;
  errors: SourceError[];
  rateLimit: RateLimitInfo | null;
}

export interface FetchOptions {
  /** ISO-8601 lower bound for the "shipped" list. */
  since: string;
  signal?: AbortSignal;
}

/**
 * A pluggable origin of fleet data. See the adapter-seam notes at the top.
 */
export interface FleetSource {
  /** Stable id, used in `SourceError.scope` and for dedupe. */
  readonly id: string;
  fetchFleet(options: FetchOptions): Promise<FleetSnapshot>;
}

/**
 * What a batched label write actually did.
 *
 * Not `void`, because GitHub answers a partially-applied batch with `HTTP 200`
 * carrying both `data` and `errors` — so "approved five" and "approved four of
 * five, and here is the one that failed" are the same HTTP outcome and only
 * differ in what the caller bothers to read. The review screen reports the
 * difference; a `Promise<void>` could not.
 */
export interface LabelBatchOutcome {
  /** Node ids the label is now on. */
  labelled: string[];
  /** Node ids it is not on, each with GitHub's reason. */
  failed: Array<{ nodeId: string; message: string }>;
}

/**
 * The write seam.
 *
 * Every method is a label, a comment, or an issue — deliberately the three least
 * powerful things that still let the review screen be a control surface. The
 * dashboard never merges a PR, never edits a workflow, never pushes a commit,
 * and (since the token audit) never **runs** a workflow either; those stay in
 * GitHub's own UI where they have GitHub's own confirmations and GitHub's own
 * attribution.
 *
 * Label *names* handed to any of these must already exist in the repo. That is
 * enforced in the implementation rather than assumed here, because the REST
 * issues endpoints create an unknown label instead of rejecting it.
 */
export interface FleetWriter {
  addLabels(slug: string, issueNumber: number, labels: string[]): Promise<void>;
  removeLabel(slug: string, issueNumber: number, label: string): Promise<void>;
  /**
   * One label onto many issues — the "approve today's plan" button. Batched in
   * chunks, and reports per issue: see `LabelBatchOutcome`.
   */
  addLabelToMany(slug: string, nodeIds: string[], label: string): Promise<LabelBatchOutcome>;
  comment(slug: string, issueNumber: number, body: string): Promise<void>;
  closeIssue(slug: string, issueNumber: number, comment: string | null): Promise<void>;
  createIssue(
    slug: string,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<{ url: string; number: number }>;
}

/** An empty snapshot — the merge identity, and what the UI renders before first fetch. */
export function emptySnapshot(): FleetSnapshot {
  return {
    fetchedAt: new Date(0).toISOString(),
    since: new Date(0).toISOString(),
    projects: [],
    needsYou: [],
    shipped: [],
    issues: [],
    spendReportedUsd: null,
    spendReportedAt: null,
    errors: [],
    rateLimit: null,
  };
}
