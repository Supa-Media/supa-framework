/**
 * The fleet-dashboard data contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ADAPTER SEAM — read this before adding a v2 data source.
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything the UI renders comes from a `FleetSource`. v1 ships exactly one
 * implementation (`sources/github/githubSource.ts`, REST + GraphQL against
 * api.github.com with a user-supplied PAT).
 *
 * A v2 source — most likely a `@supa-media/dev-assistant` Convex source that
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
 * Nothing in this file may import React or the GitHub client.
 */

import type { EngineConfig } from "../lib/engine";

/** How a pull request is blocking, as shown in the ACTIVE WORK rows. */
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

export interface Initiative {
  /** Branch prefix, or `misc` for branches with no prefix. */
  name: string;
  prs: PullRequestCard[];
}

export interface Gardener {
  repoKey: string;
  repoLabel: string;
  /** Human name, derived from the workflow file or its `name:` field. */
  name: string;
  /** e.g. `.github/workflows/gardener-triage.lock.yml`. */
  workflowPath: string;
  /** The gh-aw markdown source, e.g. `.github/workflows/gardener-triage.md`. */
  sourcePath: string;
  /** Deep link to GitHub's web editor for `sourcePath` — the one write action in v1. */
  editUrl: string;
  /**
   * Agent engine + model from the gh-aw source frontmatter, e.g.
   * `{ id: "custom", model: "qwen3-coder:480b" }`. Nulls when undeclared.
   */
  engine: EngineConfig;
  /** Raw 5-field cron expression, or `null` if the workflow has no schedule. */
  cron: string | null;
  /** Human-readable rendering of `cron`, e.g. "Mondays at 09:00 UTC". */
  schedule: string;
  /** ISO-8601 of the next scheduled fire, or `null` when unscheduled. */
  nextRunAt: string | null;
  lastRun: RunSummary | null;
  /** Month-to-date USD, or `null` when no cost report was found. */
  costMtdUsd: number | null;
}

export interface ProjectSnapshot {
  /** `owner/name`, lowercased. The merge key across sources. */
  key: string;
  label: string;
  url: string;
  defaultBranch: string;
  /** Workflow runs currently queued or in progress. */
  activeRuns: number;
  openPrs: number;
  /** Latest run on the default branch, whatever workflow it was. */
  ci: RunSummary | null;
  /** Latest *successful* run of any workflow named in the repo's `deployWorkflows`. */
  lastDeploy: RunSummary | null;
  initiatives: Initiative[];
  gardeners: Gardener[];
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
  projects: ProjectSnapshot[];
  /** PRs across every project that are blocked on a human. */
  needsYou: PullRequestCard[];
  /** Month-to-date spend across the fleet, or `null` when unknown. */
  spendMtdUsd: number | null;
  errors: SourceError[];
  rateLimit: RateLimitInfo | null;
}

/**
 * A pluggable origin of fleet data. See the adapter-seam notes at the top.
 */
export interface FleetSource {
  /** Stable id, used in `SourceError.scope` and for dedupe. */
  readonly id: string;
  fetchFleet(signal?: AbortSignal): Promise<FleetSnapshot>;
}

/** An empty snapshot — the merge identity, and what the UI renders before first fetch. */
export function emptySnapshot(): FleetSnapshot {
  return {
    fetchedAt: new Date(0).toISOString(),
    projects: [],
    needsYou: [],
    spendMtdUsd: null,
    errors: [],
    rateLimit: null,
  };
}
