/**
 * GitHub REST helpers used by the dispatch/auto-merge/reconcile actions. Ported
 * from Togather's devAssistant/actions.ts, but with the hard-coded
 * `togathernyc/togather` repo slug lifted into `RepoConfig` so the endpoints
 * are built from config. The token/`fetch` plumbing is unchanged.
 *
 * These are plain async helpers (no Convex ctx) — the action wrappers pass the
 * resolved token in.
 */

export interface RepoConfig {
  /** Repo owner/org, e.g. "togathernyc". */
  owner: string;
  /** Repo name, e.g. "togather". */
  name: string;
  /** Base branch PRs target and deploys run from (default "main"). */
  baseBranch: string;
  /**
   * Head-branch naming prefix the implement Routine uses; the bug id is
   * appended (`claude/devbug-<bugId>`). Used for merge-webhook correlation.
   */
  branchPrefix: string;
  /** Names of the workflows that deploy to STAGING on a push to the base branch. */
  stagingDeployWorkflowNames: string[];
  /** Name of the manual production deploy workflow (`workflow_run.name`). */
  productionDeployWorkflowName: string;
  /** Workflow file (for `workflow_dispatch`), e.g. "deploy-to-production.yml". */
  productionDeployWorkflowFile: string;
  /** Inputs sent with the production `workflow_dispatch` call. */
  productionDeployInputs: Record<string, string>;
  /** Provenance footer (markdown) appended to mirrored GitHub issues. */
  issueProvenanceFooter?: string;
}

const API = "https://api.github.com";

export function issuesEndpoint(repo: RepoConfig): string {
  return `${API}/repos/${repo.owner}/${repo.name}/issues`;
}
export function pullsEndpoint(repo: RepoConfig): string {
  return `${API}/repos/${repo.owner}/${repo.name}/pulls`;
}
export function workflowDispatchEndpoint(repo: RepoConfig): string {
  return `${API}/repos/${repo.owner}/${repo.name}/actions/workflows/${repo.productionDeployWorkflowFile}/dispatches`;
}

/** Head branch name for a bug's implementation PR (merge-webhook correlation). */
export function branchRefForBug(repo: RepoConfig, bugId: string): string {
  return `${repo.branchPrefix}${bugId}`;
}

/** Match `<prefix><bugId>` and return the bug id, or null. */
export function bugIdFromBranchRef(
  repo: RepoConfig,
  branchRef: string,
): string | null {
  const escaped = repo.branchPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${escaped}(.+)$`).exec(branchRef);
  return m?.[1] ?? null;
}

/** Parse the PR number from a PR html_url. */
export function prNumberFromUrl(prUrl: string): string | null {
  const m = /\/pull\/(\d+)/.exec(prUrl);
  return m?.[1] ?? null;
}

/** Standard GitHub REST headers. */
export function githubJsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/**
 * Human-readable failure detail from a GitHub error response:
 * "<prefix> returned <status> (<message>)" when the body carries a message.
 */
export async function githubErrorDetail(
  res: Response,
  prefix: string,
): Promise<string> {
  let detail = `${prefix} returned ${res.status}`;
  try {
    const errBody = (await res.json()) as { message?: string };
    if (errBody?.message) detail = `${detail} (${errBody.message})`;
  } catch {
    // Non-JSON error body; the status code is reason enough.
  }
  return detail;
}

/**
 * Merge a PR via the GitHub REST API with the configured merge method
 * (AUTO_MERGE_METHOD, default squash), retrying once with a plain merge on 405
 * ("merge method not allowed").
 */
export async function mergePullRequestOnGithub(
  repo: RepoConfig,
  prNumber: string,
  token: string,
): Promise<Response> {
  const mergePr = (mergeMethod: string): Promise<Response> =>
    fetch(`${pullsEndpoint(repo)}/${prNumber}/merge`, {
      method: "PUT",
      headers: githubJsonHeaders(token),
      body: JSON.stringify({ merge_method: mergeMethod }),
    });

  const method = process.env.AUTO_MERGE_METHOD ?? "squash";
  let res = await mergePr(method);
  if (res.status === 405 && method !== "merge") {
    res = await mergePr("merge");
  }
  return res;
}

/** Read a PR's merge state from GitHub (merged? merge SHA? mergeable_state?). */
export async function fetchPrMerged(
  repo: RepoConfig,
  prNumber: string,
  token: string,
): Promise<{
  merged: boolean;
  mergeCommitSha?: string;
  mergeableState?: string;
} | null> {
  try {
    const res = await fetch(`${pullsEndpoint(repo)}/${prNumber}`, {
      headers: githubJsonHeaders(token),
    });
    if (!res.ok) return null;
    const pr = (await res.json()) as {
      merged?: boolean;
      merge_commit_sha?: string;
      mergeable_state?: string;
    };
    return {
      merged: pr.merged === true,
      mergeCommitSha:
        typeof pr.merge_commit_sha === "string" ? pr.merge_commit_sha : undefined,
      mergeableState:
        typeof pr.mergeable_state === "string" ? pr.mergeable_state : undefined,
    };
  } catch {
    return null;
  }
}

/** Update a PR's branch by merging the base branch into it ("Update branch"). */
export async function updatePullRequestBranch(
  repo: RepoConfig,
  prNumber: string,
  token: string,
): Promise<Response> {
  return fetch(`${pullsEndpoint(repo)}/${prNumber}/update-branch`, {
    method: "PUT",
    headers: githubJsonHeaders(token),
  });
}

/** Parse the merge-commit `sha` from a successful merge PUT response (best-effort). */
export async function readMergeCommitSha(
  res: Response,
): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { sha?: string };
    return typeof body.sha === "string" ? body.sha : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a PR's `mergeable_state` means GitHub will accept a merge PUT. Both
 * `clean` and `unstable` merge (`unstable` = required checks satisfied, only
 * optional checks failing/pending, which GitHub still allows).
 */
export function isMergeableState(state: string | undefined): boolean {
  return state === "clean" || state === "unstable";
}

/** Backoff between in-app-merge recovery polls: 15s, 30s, 45s, 60s… capped at 60s. */
export function mergeRecoveryPollDelayMs(attempt: number): number {
  return Math.min(15_000 * (attempt + 1), 60_000);
}

/**
 * Body for a mirrored GitHub issue: the approved spec when there is one,
 * otherwise the raw brief (+ repro), plus a provenance footer from config.
 */
export function buildGithubIssueBody(
  repo: RepoConfig,
  bug: { spec?: string; body: string; repro?: string },
): string {
  const sections: string[] = [];
  if (bug.spec) {
    sections.push(bug.spec);
  } else {
    sections.push(bug.body);
    if (bug.repro) sections.push(`## Repro\n\n${bug.repro}`);
  }
  if (repo.issueProvenanceFooter) sections.push(repo.issueProvenanceFooter);
  return sections.join("\n\n");
}
