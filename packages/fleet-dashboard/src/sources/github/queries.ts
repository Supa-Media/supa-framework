/**
 * One GraphQL document covers every open PR in the fleet plus the gardener
 * cost issues. The REST equivalent would be, per repo: list PRs, then per PR a
 * combined-status call and a reviews call — roughly 60 requests for a fleet
 * this size.
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

/** Hard ceiling on pages fetched per repo. 100 PRs a page — 500 is plenty. */
export const MAX_PR_PAGES = 5;

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

/**
 * Build the fleet document for `repoCount` repos. Aliases are positional
 * (`repo0`, `repo1`, …) because a GraphQL alias can't contain `/` or `.`;
 * the caller maps them back by index.
 */
export function buildFleetQuery(repoCount: number): string {
  const variables = [
    ...Array.from({ length: repoCount }, (_, i) => `$q${i}: String!, $after${i}: String`),
    "$issueQuery: String!",
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
    }`,
  ).join("");

  return `${PULL_FIELDS}
  query FleetPulse(${variables}) {${searches}
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

/** Positional aliases (`repo0`…) plus the shared cost-issue search. */
export type FleetQueryResult = Record<string, GqlSearchPage | undefined> & {
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
