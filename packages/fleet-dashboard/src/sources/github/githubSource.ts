import type { FleetConfig, RepoConfig } from "../../fleet.config";
import { parseAllowlist, type Allowlist } from "../../lib/allowlist";
import {
  costForWorkflow,
  parseCostReport,
  pickLatestReports,
  reportTotal,
  type CostReport,
} from "../../lib/cost";
import { describeCrons, extractCrons, nextRunAcross } from "../../lib/cron";
import { parseCaps, parseEngine, promptBody } from "../../lib/engine";
import { parseEvidence } from "../../lib/evidence";
import { groupByInitiative, initiativeFromBranch } from "../../lib/initiative";
import { parseInitiatives, type InitiativesManifest } from "../../lib/initiativesFile";
import { hasLabel, initiativeLabels, LABELS, sizeLabel } from "../../lib/labels";
import { derivePrState, needsYouReason, type PrSignals } from "../../lib/prState";
import type {
  FetchOptions,
  FleetSnapshot,
  FleetSource,
  Gardener,
  IssueCard,
  ProjectSnapshot,
  PullRequestCard,
  RunState,
  RunSummary,
  ShippedPr,
  SourceError,
} from "../types";
import { decodeBase64Content, encodePath, GitHubClient } from "./client";
import {
  buildFleetQuery,
  buildIssueQuery,
  buildLabelQuery,
  buildMergedQuery,
  buildPrQuery,
  MAX_PR_PAGES,
  type FleetQueryResult,
  type GqlIssue,
  type GqlIssueNode,
  type GqlMerged,
  type GqlMergedPage,
  type GqlPull,
  type GqlSearchPage,
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

interface RestFile {
  content?: string;
  encoding?: string;
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
    needsYouReason: needsYouReason(signals, requestedReviewers, owner, pull.author?.login ?? null),
  };
}

function toShipped(pull: GqlMerged, label: string): ShippedPr | null {
  // A merged-PR search can only return merged PRs, but `mergedAt` is nullable
  // in the schema and the whole row is a statement about *when* it shipped —
  // rendering "merged —" would be worse than omitting it.
  if (pull.mergedAt === null) return null;
  const repoKey = pull.repository.nameWithOwner.toLowerCase();
  return {
    id: `${repoKey}#${pull.number}`,
    repoKey,
    repoLabel: label,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    mergedAt: pull.mergedAt,
    author: pull.author?.login ?? null,
    evidence: parseEvidence(pull.body),
  };
}

function toIssue(node: GqlIssueNode, repo: RepoConfig): IssueCard {
  const labels = node.labels.nodes
    .filter((label): label is { name: string } => label !== null)
    .map((label) => ({ name: label.name }));
  const names = labels.map((label) => label.name);
  const repoKey = node.repository.nameWithOwner.toLowerCase();

  return {
    id: `${repoKey}#${node.number}`,
    nodeId: node.id,
    repoKey,
    repoSlug: repo.slug,
    repoLabel: repo.label,
    number: node.number,
    title: node.title,
    url: node.url,
    body: node.body ?? "",
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    labels: names,
    initiatives: initiativeLabels(labels),
    size: sizeLabel(labels),
    automerge: hasLabel(labels, LABELS.automerge),
    notify: hasLabel(labels, LABELS.notify),
    planApproved: hasLabel(labels, LABELS.planApproved),
    comments: node.comments.nodes
      .filter((comment): comment is NonNullable<typeof comment> => comment !== null)
      .map((comment) => ({
        url: comment.url,
        body: comment.body ?? "",
        createdAt: comment.createdAt,
        author: comment.author?.login ?? null,
      })),
  };
}

interface FleetSearch {
  /** repoKey → every open PR node fetched for it. */
  pullsByRepo: Map<string, GqlPull[]>;
  /** repoKey → exact open-PR count from GitHub's `issueCount`. */
  countsByRepo: Map<string, number>;
  /** repoKey → PRs merged inside the review window. */
  mergedByRepo: Map<string, GqlMerged[]>;
  issues: GqlIssueNode[];
  costIssues: Array<GqlIssue | null>;
}

function isSearchPage(value: unknown): value is GqlSearchPage {
  return typeof value === "object" && value !== null && "pageInfo" in value;
}

/**
 * Fetch every open PR in the fleet plus the merged/labelled sets, paginating
 * each repo's open PRs independently.
 *
 * One aliased search node per repo means one HTTP request covers the whole
 * fleet in the common case, and a repo that exceeds a page pages on its own
 * without dragging the others through extra round-trips. `issueCount` is
 * recorded separately from the nodes so the project card can show a **count**
 * rather than however many nodes came back — the earlier version derived the
 * card number from `nodes.length`, so a truncated fetch silently rendered a
 * smaller, calmer, wrong number.
 *
 * Merged PRs and labelled issues are fetched once (on the first page) rather
 * than on every pagination round-trip: neither paginates, and re-asking would
 * duplicate them for exactly the repos busy enough to need a second page.
 */
async function fetchAllPulls(
  client: GitHubClient,
  repos: readonly RepoConfig[],
  since: string,
  errors: SourceError[],
  signal?: AbortSignal,
): Promise<FleetSearch> {
  const slugs = repos.map((repo) => repo.slug);
  const pullsByRepo = new Map<string, GqlPull[]>();
  const countsByRepo = new Map<string, number>();
  const mergedByRepo = new Map<string, GqlMerged[]>();
  let issues: GqlIssueNode[] = [];
  let costIssues: Array<GqlIssue | null> = [];

  const query = buildFleetQuery(slugs.length);
  const cursors: Array<string | null> = slugs.map(() => null);
  const done: boolean[] = slugs.map(() => false);
  // A repo the token can't see fails the same way on every page; reporting it
  // five times would bury the other four lines of the banner.
  const reported = new Set<string>();

  for (let page = 0; page < MAX_PR_PAGES; page += 1) {
    if (done.every(Boolean)) break;

    const variables: Record<string, unknown> = {
      issueQuery: buildIssueQuery(slugs),
      labelQuery: buildLabelQuery(slugs),
    };
    slugs.forEach((slug, i) => {
      variables[`q${i}`] = buildPrQuery(slug);
      variables[`after${i}`] = cursors[i];
      variables[`m${i}`] = buildMergedQuery(slug, since);
    });

    const result = await client
      .graphqlRaw<FleetQueryResult>(query, variables, signal)
      .catch((error: unknown) => {
        errors.push({ scope: "github", message: describeError(error) });
        return null;
      });
    if (result === null) break;

    // A partial answer is `HTTP 200` with `data` AND `errors` — one alias null
    // beside the rest. It never reaches the `.catch` above, so before this the
    // fleet just came back quietly short: no banner, no clue which repo was
    // missing. Every message is filed so the Partial-data banner can name them.
    for (const error of result.errors) {
      const message = error.message;
      if (reported.has(message)) continue;
      reported.add(message);
      errors.push({ scope: "github", message });
    }

    const data = result.data;
    if (data === null) break;

    if (page === 0) {
      costIssues = data.costIssues?.nodes ?? [];
      issues = (data.labelled?.nodes ?? []).filter(
        (node): node is GqlIssueNode => node !== null && typeof node.number === "number",
      );
      slugs.forEach((slug, i) => {
        const merged = data[`merged${i}`] as GqlMergedPage | undefined;
        mergedByRepo.set(
          slug.toLowerCase(),
          (merged?.nodes ?? []).filter(
            (node): node is GqlMerged => node !== null && typeof node.number === "number",
          ),
        );
      });
    }

    slugs.forEach((slug, i) => {
      // A repo that finished on an earlier page must be skipped, not re-read.
      // The document asks for every alias on every round-trip, so an exhausted
      // alias replays its last cursor — and for a repo that finished on page 1
      // that cursor is still `null`, so it hands back page 1 again and appends
      // a duplicate set of PRs. (Caught by forcing a 5-per-page fetch against
      // the live fleet: a 3-PR repo rendered 6 rows.)
      if (done[i]) return;

      const node = data[`repo${i}`];
      const key = slug.toLowerCase();
      if (!isSearchPage(node)) {
        done[i] = true;
        return;
      }

      countsByRepo.set(key, node.issueCount);
      const bucket = pullsByRepo.get(key) ?? [];
      for (const pull of node.nodes) {
        if (pull && typeof pull.number === "number") bucket.push(pull);
      }
      pullsByRepo.set(key, bucket);

      if (node.pageInfo.hasNextPage && node.pageInfo.endCursor !== null) {
        cursors[i] = node.pageInfo.endCursor;
      } else {
        done[i] = true;
      }
    });
  }

  return { pullsByRepo, countsByRepo, mergedByRepo, issues, costIssues };
}

/**
 * The v2 data source: GitHub REST + GraphQL, straight from the browser.
 *
 * Per-repo work is issued in parallel and each repo's failure is isolated —
 * a token that can't see one repo degrades that card, not the page. See the
 * adapter-seam contract in `sources/types.ts`.
 */
export function createGitHubSource(config: FleetConfig, token: string): FleetSource {
  const client = new GitHubClient(token);

  return {
    id: "github",
    async fetchFleet({ since, signal }: FetchOptions): Promise<FleetSnapshot> {
      const errors: SourceError[] = [];
      const search = await fetchAllPulls(client, config.repos, since, errors, signal);

      const costIssues = search.costIssues
        .filter((node): node is GqlIssue => node !== null && typeof node.title === "string")
        .map((node) => ({ ...node, repoKey: node.repository.nameWithOwner.toLowerCase() }));

      const latestIssues = pickLatestReports(costIssues, config.costIssueTitle);
      const costByRepo = new Map<string, CostReport>();
      for (const [repoKey, issue] of latestIssues) {
        costByRepo.set(repoKey, parseCostReport(issue.body ?? ""));
      }

      const projects = await Promise.all(
        config.repos.map((repo) =>
          buildProject(client, config, repo, search, costByRepo, errors, signal),
        ),
      );

      const needsYou = projects
        .flatMap((project) => project.initiatives.flatMap((initiative) => initiative.prs))
        .filter((pr) => pr.needsYouReason !== null)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

      const byKey = new Map(config.repos.map((repo) => [repo.slug.toLowerCase(), repo]));

      const shipped = config.repos
        .flatMap((repo) =>
          (search.mergedByRepo.get(repo.slug.toLowerCase()) ?? [])
            .map((pull) => toShipped(pull, repo.label))
            .filter((item): item is ShippedPr => item !== null),
        )
        .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));

      const issues = search.issues
        .map((node) => {
          const repo = byKey.get(node.repository.nameWithOwner.toLowerCase());
          return repo === undefined ? null : toIssue(node, repo);
        })
        .filter((issue): issue is IssueCard => issue !== null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      const spendValues = [...costByRepo.values()]
        .map(reportTotal)
        .filter((value): value is number => value !== null);
      const reportTimes = [...latestIssues.values()].map((issue) => issue.updatedAt).sort();

      return {
        fetchedAt: new Date().toISOString(),
        since,
        projects,
        needsYou,
        shipped,
        issues,
        spendReportedUsd: spendValues.length > 0 ? spendValues.reduce((a, b) => a + b, 0) : null,
        spendReportedAt: reportTimes[reportTimes.length - 1] ?? null,
        errors,
        rateLimit: client.rateLimit,
      };
    },
  };
}

/** Fetch a repo file as text. Missing (404) and unreadable both yield `null`. */
async function readFile(
  client: GitHubClient,
  slug: string,
  path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const response = await client
    .rest<RestFile>(`/repos/${slug}/contents/${encodePath(path)}`, signal)
    .catch(() => null);
  if (!response?.content || response.encoding !== "base64") return null;
  try {
    return decodeBase64Content(response.content);
  } catch {
    return null;
  }
}

async function buildProject(
  client: GitHubClient,
  config: FleetConfig,
  repo: RepoConfig,
  search: FleetSearch,
  costByRepo: Map<string, CostReport>,
  errors: SourceError[],
  signal?: AbortSignal,
): Promise<ProjectSnapshot> {
  const key = repo.slug.toLowerCase();
  const pulls = search.pullsByRepo.get(key) ?? [];
  const cards = pulls
    .map((pull) => toCard(pull, repo.label, config.owner))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const project: ProjectSnapshot = {
    key,
    slug: repo.slug,
    label: repo.label,
    url: `https://github.com/${repo.slug}`,
    defaultBranch: "main",
    activeRuns: 0,
    // The exact count, not `cards.length` — those differ when the repo has
    // more open PRs than the pagination cap fetches.
    openPrs: search.countsByRepo.get(key) ?? cards.length,
    fetchedPrs: cards.length,
    ci: null,
    lastDeploy: null,
    lastProdDeploy: null,
    initiatives: groupByInitiative(cards, (card) => card.initiative).map((group) => ({
      name: group.name,
      prs: group.items,
    })),
    gardeners: [],
    manifest: { entries: [], problems: [] } satisfies InitiativesManifest,
    allowlist: { required: [], optional: [], problem: null } satisfies Allowlist,
    secretNames: null,
  };

  const fail = (message: string) => errors.push({ scope: repo.slug, message });

  // Default branch first — the CI reading depends on knowing it.
  try {
    const meta = await client.rest<{ default_branch: string }>(`/repos/${repo.slug}`, signal);
    project.defaultBranch = meta.default_branch;
  } catch (error) {
    fail(describeError(error));
  }

  const branch = encodeURIComponent(project.defaultBranch);
  const [runsResult, ciResult, deployResults, gardenersResult, manifestText, allowlistText, secrets] =
    await Promise.all([
      // One page of recent runs across all refs gives the active-run count.
      client
        .rest<{ workflow_runs: RestRun[] }>(`/repos/${repo.slug}/actions/runs?per_page=100`, signal)
        .catch((error: unknown) => {
          fail(describeError(error));
          return null;
        }),
      // CI gets its own branch-filtered call rather than being mined out of the
      // 100-run page above. On a repo where PR CI dominates — togather being the
      // case — 100 runs can be one busy afternoon with no default-branch run in
      // the window, and the card would read "no runs" when it means "I could not
      // see far enough back". One extra ETag-cached request buys an exact answer.
      client
        .rest<{ workflow_runs: RestRun[] }>(
          `/repos/${repo.slug}/actions/runs?branch=${branch}&per_page=1`,
          signal,
        )
        .catch(() => null),
      Promise.all(
        repo.deployWorkflows.map(async (workflow) => ({
          workflow,
          runs: await client
            .rest<{ workflow_runs: RestRun[] }>(
              `/repos/${repo.slug}/actions/workflows/${encodeURIComponent(workflow)}/runs?status=success&per_page=1`,
              signal,
            )
            // A repo may not have every configured deploy workflow; that's a
            // config drift worth ignoring quietly rather than a fleet error.
            .catch(() => null),
        })),
      ),
      loadGardeners(
        client,
        config,
        repo,
        project.defaultBranch,
        costByRepo.get(key) ?? null,
        signal,
      ).catch((error: unknown) => {
        fail(describeError(error));
        return [] as Gardener[];
      }),
      readFile(client, repo.slug, config.initiativesPath, signal),
      repo.secretsAllowlistPath === null
        ? Promise.resolve(null)
        : readFile(client, repo.slug, repo.secretsAllowlistPath, signal),
      // Needs an admin-scoped token. A 403 is the normal case for the read-only
      // PAT the README recommends, so it degrades to "unknown" rather than an
      // error the user is asked to act on.
      client
        .rest<{ secrets: Array<{ name: string }> }>(
          `/repos/${repo.slug}/actions/secrets?per_page=100`,
          signal,
        )
        .catch(() => null),
    ]);

  if (runsResult) {
    project.activeRuns = runsResult.workflow_runs.filter(
      (run) => run.status !== null && ACTIVE_RUN_STATUSES.has(run.status),
    ).length;
  }

  const latestOnDefault = ciResult?.workflow_runs[0];
  project.ci = latestOnDefault ? toRunSummary(latestOnDefault) : null;

  const deploys = deployResults
    .flatMap((result) => result.runs?.workflow_runs ?? [])
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  project.lastDeploy = deploys[0] ? toRunSummary(deploys[0]) : null;

  const prodRun = deployResults.find((result) => result.workflow === repo.productionWorkflow)?.runs
    ?.workflow_runs[0];
  project.lastProdDeploy = prodRun ? toRunSummary(prodRun) : null;

  project.gardeners = gardenersResult;
  project.manifest = parseInitiatives(manifestText);
  project.allowlist = parseAllowlist(allowlistText);
  project.secretNames = secrets === null ? null : secrets.secrets.map((secret) => secret.name);
  return project;
}

/**
 * Find gh-aw gardener workflows and enrich them with schedule, last run, caps,
 * prompt, and cost. gh-aw compiles `gardener-x.md` into `gardener-x.lock.yml`;
 * the lock file is what Actions runs and what carries the cron, while the `.md`
 * is what a human edits — hence the two paths on `Gardener`.
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
      // frontmatter, the caps, and the prompt. Both are ETag-cached, so a
      // refresh re-reads neither.
      const [yaml, source, runs] = await Promise.all([
        readFile(client, repo.slug, entry.path, signal),
        readFile(client, repo.slug, sourcePath, signal),
        client
          .rest<{ workflow_runs: RestRun[] }>(
            `/repos/${repo.slug}/actions/workflows/${encodeURIComponent(entry.name)}/runs?per_page=1`,
            signal,
          )
          .catch(() => null),
      ]);

      const lockYaml = yaml ?? "";
      const sourceText = source ?? "";
      const crons = lockYaml === "" ? [] : extractCrons(lockYaml);
      const next = nextRunAcross(crons);
      const lastRunNode = runs?.workflow_runs[0];
      // The workflow file's own `name:` wins. The Actions API reports a run's
      // name as the workflow *path* when the workflow was renamed (or never
      // named), which reads as `.github/workflows/x.lock.yml` in the table —
      // so the run name is only a fallback, and only when it isn't a path.
      const runName = lastRunNode?.name;
      const displayName =
        nameFromYaml(lockYaml) ??
        (runName !== undefined && runName !== null && !runName.includes("/") ? runName : null) ??
        baseName;

      return {
        repoKey: repo.slug.toLowerCase(),
        repoSlug: repo.slug,
        repoLabel: repo.label,
        name: displayName,
        workflowPath: entry.path,
        sourcePath,
        editUrl: `https://github.com/${repo.slug}/edit/${encodeURIComponent(defaultBranch)}/${encodePath(sourcePath)}`,
        engine: parseEngine(sourceText),
        caps: parseCaps(sourceText),
        prompt: promptBody(sourceText),
        crons,
        schedule: describeCrons(crons),
        nextRunAt: next === null ? null : next.toISOString(),
        lastRun: lastRunNode ? toRunSummary(lastRunNode) : null,
        costReportedUsd: costReport
          ? costForWorkflow(costReport, displayName, baseName, entry.name, sourcePath)
          : null,
      };
    }),
  );
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
