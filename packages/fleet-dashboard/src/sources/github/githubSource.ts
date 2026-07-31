import type { FleetConfig, RepoConfig } from "../../fleet.config";
import { costForWorkflow, parseCostReport, reportTotal, type CostReport } from "../../lib/cost";
import { describeCron, extractCron, nextRun } from "../../lib/cron";
import { parseEngine } from "../../lib/engine";
import { groupByInitiative, initiativeFromBranch } from "../../lib/initiative";
import { derivePrState, needsYouReason, type PrSignals } from "../../lib/prState";
import type {
  FleetSnapshot,
  FleetSource,
  Gardener,
  ProjectSnapshot,
  PullRequestCard,
  RunState,
  RunSummary,
  SourceError,
} from "../types";
import { decodeBase64Content, GitHubClient } from "./client";
import {
  buildIssueQuery,
  buildPrQuery,
  FLEET_QUERY,
  type FleetQueryResult,
  type GqlPull,
} from "./queries";

/** Statuses GitHub reports for a run that hasn't finished yet. */
const ACTIVE_RUN_STATUSES = new Set(["queued", "in_progress", "requested", "waiting", "pending"]);

interface RestRun {
  id: number;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  html_url: string;
  path?: string;
  created_at: string;
  updated_at: string;
}

interface RestContentEntry {
  name: string;
  path: string;
  type: string;
}

function mapRunState(status: string | null, conclusion: string | null): RunState {
  if (status !== null && ACTIVE_RUN_STATUSES.has(status)) return "running";
  switch (conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "startup_failure":
      return "failure";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function toRunSummary(run: RestRun): RunSummary {
  const state = mapRunState(run.status, run.conclusion);
  return {
    name: run.name ?? "workflow",
    state,
    at: state === "running" ? run.created_at : run.updated_at,
    url: run.html_url,
  };
}

/** Turn one GraphQL PR node into the card the UI renders. */
function toCard(pull: GqlPull, label: string, owner: string): PullRequestCard {
  const requestedReviewers = pull.reviewRequests.nodes
    .map((node) => node?.requestedReviewer?.login ?? node?.requestedReviewer?.slug)
    .filter((login): login is string => typeof login === "string");

  const signals: PrSignals = {
    isDraft: pull.isDraft,
    checkState: pull.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    mergeable: pull.mergeable,
    reviewDecision: pull.reviewDecision,
    hasRequestedReviewers: requestedReviewers.length > 0,
  };

  const repoKey = pull.repository.nameWithOwner.toLowerCase();
  return {
    id: `${repoKey}#${pull.number}`,
    repoKey,
    repoLabel: label,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    branch: pull.headRefName,
    initiative: initiativeFromBranch(pull.headRefName),
    state: derivePrState(signals),
    isDraft: pull.isDraft,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    requestedReviewers,
    needsYouReason: needsYouReason(signals, requestedReviewers, owner),
  };
}

/**
 * The v1 data source: GitHub REST + GraphQL, straight from the browser.
 *
 * Per-repo work is issued in parallel and each repo's failure is isolated —
 * a token that can't see one repo degrades that card, not the page. See the
 * adapter-seam contract in `sources/types.ts`.
 */
export function createGitHubSource(config: FleetConfig, token: string): FleetSource {
  const client = new GitHubClient(token);

  return {
    id: "github",
    async fetchFleet(signal?: AbortSignal): Promise<FleetSnapshot> {
      const errors: SourceError[] = [];
      const slugs = config.repos.map((repo) => repo.slug);

      const fleetData = await client
        .graphql<FleetQueryResult>(
          FLEET_QUERY,
          { prQuery: buildPrQuery(slugs), issueQuery: buildIssueQuery(slugs) },
          signal,
        )
        .catch((error: unknown) => {
          errors.push({ scope: "github", message: describeError(error) });
          return null;
        });

      const pullsByRepo = new Map<string, GqlPull[]>();
      for (const node of fleetData?.pulls.nodes ?? []) {
        if (!node || typeof node.number !== "number") continue;
        const key = node.repository.nameWithOwner.toLowerCase();
        const bucket = pullsByRepo.get(key);
        if (bucket) bucket.push(node);
        else pullsByRepo.set(key, [node]);
      }

      const costByRepo = new Map<string, CostReport>();
      for (const node of fleetData?.costIssues.nodes ?? []) {
        if (!node || typeof node.title !== "string") continue;
        if (!node.title.toLowerCase().includes(config.costIssueTitle.toLowerCase())) continue;
        costByRepo.set(node.repository.nameWithOwner.toLowerCase(), parseCostReport(node.body ?? ""));
      }

      const projects = await Promise.all(
        config.repos.map((repo) =>
          buildProject(client, config, repo, pullsByRepo, costByRepo, errors, signal),
        ),
      );

      const needsYou = projects
        .flatMap((project) => project.initiatives.flatMap((initiative) => initiative.prs))
        .filter((pr) => pr.needsYouReason !== null)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

      const spendValues = [...costByRepo.values()]
        .map(reportTotal)
        .filter((value): value is number => value !== null);

      return {
        fetchedAt: new Date().toISOString(),
        projects,
        needsYou,
        spendMtdUsd: spendValues.length > 0 ? spendValues.reduce((a, b) => a + b, 0) : null,
        errors,
        rateLimit: client.rateLimit,
      };
    },
  };
}

async function buildProject(
  client: GitHubClient,
  config: FleetConfig,
  repo: RepoConfig,
  pullsByRepo: Map<string, GqlPull[]>,
  costByRepo: Map<string, CostReport>,
  errors: SourceError[],
  signal?: AbortSignal,
): Promise<ProjectSnapshot> {
  const key = repo.slug.toLowerCase();
  const pulls = pullsByRepo.get(key) ?? [];
  const cards = pulls
    .map((pull) => toCard(pull, repo.label, config.owner))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const project: ProjectSnapshot = {
    key,
    label: repo.label,
    url: `https://github.com/${repo.slug}`,
    defaultBranch: "main",
    activeRuns: 0,
    openPrs: cards.length,
    ci: null,
    lastDeploy: null,
    initiatives: groupByInitiative(cards, (card) => card.initiative).map((group) => ({
      name: group.name,
      prs: group.items,
    })),
    gardeners: [],
  };

  const fail = (message: string) => errors.push({ scope: repo.slug, message });

  // Default branch first — the CI reading depends on knowing it.
  try {
    const meta = await client.rest<{ default_branch: string }>(`/repos/${repo.slug}`, signal);
    project.defaultBranch = meta.default_branch;
  } catch (error) {
    fail(describeError(error));
  }

  const [runsResult, deployResults, gardenersResult] = await Promise.all([
    // One page of recent runs answers both "how many are active" and "what is
    // CI on the default branch", instead of two filtered queries.
    client
      .rest<{ workflow_runs: RestRun[] }>(`/repos/${repo.slug}/actions/runs?per_page=100`, signal)
      .catch((error: unknown) => {
        fail(describeError(error));
        return null;
      }),
    Promise.all(
      repo.deployWorkflows.map((workflow) =>
        client
          .rest<{ workflow_runs: RestRun[] }>(
            `/repos/${repo.slug}/actions/workflows/${workflow}/runs?status=success&per_page=1`,
            signal,
          )
          // A repo may not have every configured deploy workflow; that's a
          // config drift worth ignoring quietly rather than a fleet error.
          .catch(() => null),
      ),
    ),
    loadGardeners(client, config, repo, project.defaultBranch, costByRepo.get(key) ?? null, signal).catch(
      (error: unknown) => {
        fail(describeError(error));
        return [] as Gardener[];
      },
    ),
  ]);

  if (runsResult) {
    const runs = runsResult.workflow_runs;
    project.activeRuns = runs.filter(
      (run) => run.status !== null && ACTIVE_RUN_STATUSES.has(run.status),
    ).length;

    const latestOnDefault = runs.find((run) => run.head_branch === project.defaultBranch);
    project.ci = latestOnDefault ? toRunSummary(latestOnDefault) : null;
  }

  const deploys = deployResults
    .flatMap((result) => result?.workflow_runs ?? [])
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  project.lastDeploy = deploys[0] ? toRunSummary(deploys[0]) : null;

  project.gardeners = gardenersResult;
  return project;
}

/**
 * Find gh-aw gardener workflows and enrich them with schedule, last run, and
 * cost. gh-aw compiles `gardener-x.md` into `gardener-x.lock.yml`; the lock
 * file is what Actions runs and what carries the cron, while the `.md` is what
 * a human edits — hence the two paths on `Gardener`.
 */
async function loadGardeners(
  client: GitHubClient,
  config: FleetConfig,
  repo: RepoConfig,
  defaultBranch: string,
  costReport: CostReport | null,
  signal?: AbortSignal,
): Promise<Gardener[]> {
  let entries: RestContentEntry[];
  try {
    entries = await client.rest<RestContentEntry[]>(
      `/repos/${repo.slug}/contents/.github/workflows`,
      signal,
    );
  } catch {
    // No .github/workflows directory at all — not an error worth showing.
    return [];
  }

  const lockFiles = entries.filter(
    (entry) =>
      entry.type === "file" &&
      entry.name.startsWith(config.gardenerPrefix) &&
      entry.name.endsWith(config.gardenerSuffix),
  );

  return Promise.all(
    lockFiles.map(async (entry): Promise<Gardener> => {
      const baseName = entry.name.slice(0, -config.gardenerSuffix.length);
      const sourcePath = `${entry.path.slice(0, -config.gardenerSuffix.length)}.md`;

      // Both files are needed, and each answers something the other can't:
      // the compiled lock file carries the REAL cron (gh-aw lets the source
      // write a friendly one like "daily around 12:00 on weekdays" and
      // compiles it down), while only the markdown source carries the engine
      // frontmatter. Both are ETag-cached, so a refresh re-reads neither.
      const [content, sourceContent, runs] = await Promise.all([
        client
          .rest<{ content?: string; encoding?: string }>(
            `/repos/${repo.slug}/contents/${entry.path}`,
            signal,
          )
          .catch(() => null),
        client
          .rest<{ content?: string; encoding?: string }>(
            `/repos/${repo.slug}/contents/${sourcePath}`,
            signal,
          )
          .catch(() => null),
        client
          .rest<{ workflow_runs: RestRun[] }>(
            `/repos/${repo.slug}/actions/workflows/${entry.name}/runs?per_page=1`,
            signal,
          )
          .catch(() => null),
      ]);

      const yaml = decodeContents(content);
      const cron = yaml === "" ? null : extractCron(yaml);
      const engine = parseEngine(decodeContents(sourceContent));
      const next = cron === null ? null : nextRun(cron);
      const lastRunNode = runs?.workflow_runs[0];
      // The workflow file's own `name:` wins. The Actions API reports a run's
      // name as the workflow *path* when the workflow was renamed (or never
      // named), which reads as `.github/workflows/x.lock.yml` in the table —
      // so the run name is only a fallback, and only when it isn't a path.
      const runName = lastRunNode?.name;
      const displayName =
        nameFromYaml(yaml) ??
        (runName !== undefined && runName !== null && !runName.includes("/") ? runName : null) ??
        baseName;

      return {
        repoKey: repo.slug.toLowerCase(),
        repoLabel: repo.label,
        name: displayName,
        workflowPath: entry.path,
        sourcePath,
        editUrl: `https://github.com/${repo.slug}/edit/${defaultBranch}/${sourcePath}`,
        engine,
        cron,
        schedule: cron === null ? "manual / event-driven" : describeCron(cron),
        nextRunAt: next === null ? null : next.toISOString(),
        lastRun: lastRunNode ? toRunSummary(lastRunNode) : null,
        costMtdUsd: costReport
          ? costForWorkflow(costReport, displayName, baseName, entry.name, sourcePath)
          : null,
      };
    }),
  );
}

/** Base64 `contents` payload → text, or `""` when the fetch failed or was too big. */
function decodeContents(response: { content?: string; encoding?: string } | null): string {
  if (!response?.content || response.encoding !== "base64") return "";
  return decodeBase64Content(response.content);
}

/** Top-level `name:` from a workflow YAML — same trade-off as `extractCron`. */
function nameFromYaml(yaml: string): string | null {
  const match = /^name:\s*(?:"([^"]+)"|'([^']+)'|(.+?))\s*$/m.exec(yaml);
  if (!match) return null;
  const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  return value === "" ? null : value;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
