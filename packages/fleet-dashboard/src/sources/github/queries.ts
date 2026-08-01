/**
 * One GraphQL document covers every open PR in the fleet, every PR merged since
 * the last review, every labelled issue, and the gardener cost issues. The REST
 * equivalent would be, per repo: list PRs, then per PR a combined-status call
 * and a reviews call, then a comments call per issue — several hundred requests
 * for a fleet this size.
 *
 * The document is built per fetch rather than being a constant, because it
 * carries **one aliased search node per repo** instead of a single search with
 * several `repo:` qualifiers. That costs nothing extra (still one HTTP request)
 * and buys three things:
 *
 *   - an exact `issueCount` per repo, so the project card's "Open PRs" number
 *     is a real count rather than however many nodes happened to come back;
 *   - independent cursors, so a repo with 300 open PRs pages on its own;
 *   - no dependence on how many `repo:` qualifiers a single search term
 *     accepts, which was previously a documented-but-unenforced cap.
 */

import { LABELS } from "../../lib/labels";

/** Hard ceiling on pages fetched per repo. 100 PRs a page — 500 is plenty. */
export const MAX_PR_PAGES = 5;

/**
 * Merges fetched per repo per review window. The window is ~12 hours; a repo
 * that merges more than 50 PRs between two reviews has bigger questions than
 * this list, and the UI says when it truncated.
 */
export const MAX_MERGED = 50;

/**
 * Labelled issues fetched across the whole fleet. Not paginated: the queue is
 * meant to be a day's work, and a "queue" of 200 is a signal, not a list to
 * scroll. The UI shows the true `issueCount` beside the rows.
 */
export const MAX_ISSUES = 100;

/**
 * Comments read per issue, newest last. Markers (`**[decider]**`, context
 * sheets, questions) are written by agents at the end of a working session, so
 * the recent tail is where they are. An issue with a 60-comment history is a
 * conversation, and the honest move there is to open it.
 */
export const MAX_ISSUE_COMMENTS = 20;

const PULL_FIELDS = /* GraphQL */ `
  fragment PullFields on PullRequest {
    number
    title
    url
    isDraft
    createdAt
    updatedAt
    headRefName
    mergeable
    reviewDecision
    author {
      login
    }
    repository {
      nameWithOwner
    }
    reviewRequests(first: 20) {
      nodes {
        requestedReviewer {
          ... on User {
            login
          }
          ... on Team {
            slug
          }
        }
      }
    }
    commits(last: 1) {
      nodes {
        commit {
          statusCheckRollup {
            state
          }
        }
      }
    }
  }
`;

const MERGED_FIELDS = /* GraphQL */ `
  fragment MergedFields on PullRequest {
    number
    title
    url
    body
    mergedAt
    author {
      login
    }
    repository {
      nameWithOwner
    }
  }
`;

const ISSUE_FIELDS = /* GraphQL */ `
  fragment IssueFields on Issue {
    id
    number
    title
    url
    body
    createdAt
    updatedAt
    repository {
      nameWithOwner
    }
    labels(first: 30) {
      nodes {
        name
      }
    }
    comments(last: ${MAX_ISSUE_COMMENTS}) {
      nodes {
        url
        body
        createdAt
        author {
          login
        }
      }
    }
  }
`;

/**
 * Build the fleet document for `repoCount` repos. Aliases are positional
 * (`repo0`, `repo1`, …) because a GraphQL alias can't contain `/` or `.`;
 * the caller maps them back by index.
 */
export function buildFleetQuery(repoCount: number): string {
  const variables = [
    ...Array.from({ length: repoCount }, (_, i) => `$q${i}: String!, $after${i}: String`),
    ...Array.from({ length: repoCount }, (_, i) => `$m${i}: String!`),
    "$issueQuery: String!",
    "$labelQuery: String!",
  ].join(", ");

  const searches = Array.from(
    { length: repoCount },
    (_, i) => `
    repo${i}: search(query: $q${i}, type: ISSUE, first: 100, after: $after${i}) {
      issueCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...PullFields
      }
    }
    merged${i}: search(query: $m${i}, type: ISSUE, first: ${MAX_MERGED}) {
      issueCount
      nodes {
        ...MergedFields
      }
    }`,
  ).join("");

  return `${PULL_FIELDS}
  ${MERGED_FIELDS}
  ${ISSUE_FIELDS}
  query FleetPulse(${variables}) {${searches}
    labelled: search(query: $labelQuery, type: ISSUE, first: ${MAX_ISSUES}) {
      issueCount
      nodes {
        ...IssueFields
      }
    }
    costIssues: search(query: $issueQuery, type: ISSUE, first: 20) {
      nodes {
        ... on Issue {
          title
          body
          updatedAt
          url
          repository {
            nameWithOwner
          }
        }
      }
    }
  }`;
}

export interface GqlPull {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  reviewRequests: {
    nodes: Array<{ requestedReviewer: { login?: string; slug?: string } | null } | null>;
  };
  commits: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          state: "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";
        } | null;
      };
    } | null>;
  };
}

export interface GqlMerged {
  number: number;
  title: string;
  url: string;
  body: string | null;
  mergedAt: string | null;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
}

export interface GqlIssueNode {
  id: string;
  number: number;
  title: string;
  url: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  repository: { nameWithOwner: string };
  labels: { nodes: Array<{ name: string } | null> };
  comments: {
    nodes: Array<{
      url: string;
      body: string | null;
      createdAt: string;
      author: { login: string } | null;
    } | null>;
  };
}

export interface GqlIssue {
  title: string;
  body: string;
  updatedAt: string;
  url: string;
  repository: { nameWithOwner: string };
}

export interface GqlSearchPage {
  issueCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: Array<GqlPull | null>;
}

export interface GqlMergedPage {
  issueCount: number;
  nodes: Array<GqlMerged | null>;
}

export interface GqlIssuePage {
  issueCount: number;
  nodes: Array<GqlIssueNode | null>;
}

/** Positional aliases (`repo0`, `merged0`…) plus the three shared searches. */
export type FleetQueryResult = Record<string, GqlSearchPage | GqlMergedPage | undefined> & {
  labelled?: GqlIssuePage;
  costIssues?: { nodes: Array<GqlIssue | null> };
};

/**
 * `repo:a/b is:pr is:open sort:updated-desc`.
 *
 * `sort:updated-desc` matters even though every page is normally fetched: if a
 * repo ever exceeds `MAX_PR_PAGES`, the PRs that survive the cap are the
 * recently active ones rather than an arbitrary best-match slice.
 */
export function buildPrQuery(slug: string): string {
  return `repo:${slug} is:pr is:open sort:updated-desc`;
}

/**
 * `repo:a/b is:pr is:merged merged:>=<since> sort:updated-desc`.
 *
 * GitHub's search takes a full ISO-8601 instant here, so the window is exact
 * rather than day-granular — which matters when the two reviews of a day are
 * twelve hours apart and a day-granular filter would show the morning's merges
 * again at night.
 */
export function buildMergedQuery(slug: string, since: string): string {
  return `repo:${slug} is:pr is:merged merged:>=${since} sort:updated-desc`;
}

/**
 * Every issue in the fleet carrying a label the dashboard reads.
 *
 * One search, not one per label: GitHub's `label:"a","b"` is an OR, so the whole
 * vocabulary fits in a single node.
 *
 * Quoted because a label name may contain a space or a `/`
 * (`label:"Planning/New feature"` is a real one in the fleet), and unquoted
 * those terminate the qualifier. **Not** because of the `:` — replayed against
 * the live API, `label:type:bug` and `label:"type:bug"` both return the same
 * 32,247, since search takes everything after the first colon as the value. The
 * rule is still "always quote", but for the reason above; the earlier note here
 * claimed unquoted silently matched nothing, and someone trusting that rationale
 * could have "simplified" the quoting away on a fleet whose label names happen
 * to be colon-only.
 */
export function buildLabelQuery(slugs: readonly string[]): string {
  const labels = [
    LABELS.ready,
    LABELS.inProgress,
    LABELS.blocked,
    LABELS.inboxProposed,
    LABELS.inboxRaw,
    LABELS.watchdogReport,
  ]
    .map((label) => `"${label}"`)
    .join(",");

  return [
    "is:issue",
    "is:open",
    `label:${labels}`,
    "sort:updated-desc",
    ...slugs.map((slug) => `repo:${slug}`),
  ].join(" ");
}

/**
 * Deliberately loose on the title — GitHub's search syntax mangles the `&` and
 * `[]` in `[gardeners] weekly cost & activity report`, so the real title check
 * happens on the client. `is:open` and `sort:updated-desc` are not loose: the
 * report is weekly, so a repo running gardeners for a year has ~52 of them, and
 * picking the wrong one would present a stale week as current.
 */
export function buildIssueQuery(slugs: readonly string[]): string {
  return [
    "is:issue",
    "is:open",
    "gardeners in:title",
    "sort:updated-desc",
    ...slugs.map((slug) => `repo:${slug}`),
  ].join(" ");
}

/**
 * Aliases per `ApprovePlan` mutation.
 *
 * `selectPlan` groups every unapproved `agent:ready` issue and `MAX_ISSUES` is
 * 100 fleet-wide, so one click could otherwise build a hundred-alias document.
 * GitHub runs mutation aliases **serially**, which makes that both the slowest
 * request the app can send and the one most likely to time out half-applied.
 * Twenty costs one extra round-trip in the rare case; the caller reports per
 * chunk, so a failure in the third does not erase the first two.
 */
export const MAX_APPROVE_BATCH = 20;

/**
 * The batched "approve today's plan" mutation: one label onto many issues, one
 * round-trip. Aliases are positional for the same reason the searches are — and
 * the caller maps a failing `path: ["add3"]` back to the third node id, which is
 * how a partial failure names the issues it did not label.
 */
export function buildAddLabelMutation(count: number): string {
  const variables = [
    "$labelId: ID!",
    ...Array.from({ length: count }, (_, i) => `$target${i}: ID!`),
  ].join(", ");

  const fields = Array.from(
    { length: count },
    (_, i) => `
    add${i}: addLabelsToLabelable(input: { labelableId: $target${i}, labelIds: [$labelId] }) {
      clientMutationId
    }`,
  ).join("");

  return `mutation ApprovePlan(${variables}) {${fields}\n  }`;
}

/**
 * Resolve several label *names* to node ids in one round-trip.
 *
 * Every write path goes through this, not just the batched approve: the REST
 * issues endpoint **creates** a label it doesn't recognize, so "the dashboard
 * refuses to create a label" is only true if the names are checked before the
 * REST call rather than by it. A missing label answers `null` for its alias
 * with no `errors` entry, which is what lets one query check a set and report
 * exactly which member is absent.
 */
export function buildLabelIdsQuery(count: number): string {
  const variables = [
    "$owner: String!",
    "$name: String!",
    ...Array.from({ length: count }, (_, i) => `$label${i}: String!`),
  ].join(", ");

  const fields = Array.from(
    { length: count },
    (_, i) => `
      l${i}: label(name: $label${i}) {
        id
      }`,
  ).join("");

  return `query LabelIds(${variables}) {
    repository(owner: $owner, name: $name) {${fields}
    }
  }`;
}
