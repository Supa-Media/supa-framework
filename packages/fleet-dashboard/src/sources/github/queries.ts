/**
 * One GraphQL round-trip covers every open PR in the fleet plus the gardener
 * cost issues. The REST equivalent would be, per repo: list PRs, then per PR a
 * combined-status call and a reviews call — roughly 60 requests for a fleet
 * this size. GitHub's search node returns all of it at once.
 */

export const FLEET_QUERY = /* GraphQL */ `
  query FleetPulse($prQuery: String!, $issueQuery: String!) {
    pulls: search(query: $prQuery, type: ISSUE, first: 100) {
      nodes {
        ... on PullRequest {
          number
          title
          url
          isDraft
          createdAt
          updatedAt
          headRefName
          mergeable
          reviewDecision
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
      }
    }
    costIssues: search(query: $issueQuery, type: ISSUE, first: 20) {
      nodes {
        ... on Issue {
          title
          body
          updatedAt
          repository {
            nameWithOwner
          }
        }
      }
    }
  }
`;

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
  repository: { nameWithOwner: string };
}

export interface FleetQueryResult {
  pulls: { nodes: Array<GqlPull | null> };
  costIssues: { nodes: Array<GqlIssue | null> };
}

/** `is:pr is:open repo:a/b repo:c/d` — search caps at 5 repo qualifiers per term. */
export function buildPrQuery(slugs: readonly string[]): string {
  return ["is:pr", "is:open", ...slugs.map((slug) => `repo:${slug}`)].join(" ");
}

/**
 * Deliberately loose: search on `gardeners in:title` and let
 * `parseCostReport` + a title check on the client decide what's really a cost
 * report. GitHub's search syntax mangles the `&` and `[]` in the real title.
 */
export function buildIssueQuery(slugs: readonly string[]): string {
  return ["is:issue", "gardeners in:title", ...slugs.map((slug) => `repo:${slug}`)].join(" ");
}
