import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { fleetConfig } from "../src/fleet.config";
import { createGitHubSource } from "../src/sources/github/githubSource";

/**
 * The read half of the partial-success finding.
 *
 * `snapshot.errors` drives the "Partial data — the rest of the page is still
 * accurate" banner. It used to be fed only from the `.catch()` around the fleet
 * query, which an `HTTP 200` never reaches — so a repo the token could not see
 * came back as a quietly short fleet with no banner and nothing naming the repo.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const GRAPHQL_ERROR = "Could not resolve to a Repository with the name 'shyoh/fount-studios'.";

function fleetPayload(hasNextPage: boolean): unknown {
  const data: Record<string, unknown> = {
    labelled: { issueCount: 0, nodes: [] },
    costIssues: { nodes: [] },
  };
  fleetConfig.repos.forEach((_repo, index) => {
    data[`repo${index}`] = {
      issueCount: 0,
      pageInfo: { hasNextPage: index === 0 && hasNextPage, endCursor: "cursor-1" },
      nodes: [],
    };
    data[`merged${index}`] = { issueCount: 0, nodes: [] };
  });
  // Exactly GitHub's shape for a per-alias failure: 200, data AND errors.
  return { data, errors: [{ type: "NOT_FOUND", path: ["repo2"], message: GRAPHQL_ERROR }] };
}

test("a 200 with data and errors still fills the Partial-data banner, once", async () => {
  let graphqlCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).endsWith("/graphql")) {
      graphqlCalls += 1;
      return new Response(JSON.stringify(fleetPayload(graphqlCalls === 1)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // Everything REST is out of scope here and degrades per repo, as designed.
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  }) as typeof fetch;

  const snapshot = await createGitHubSource(fleetConfig, "t").fetchFleet({
    since: "2026-08-01T00:00:00.000Z",
  });

  const graphqlErrors = snapshot.errors.filter((error) => error.message === GRAPHQL_ERROR);
  assert.equal(graphqlErrors.length, 1, "reported once, not once per pagination round-trip");
  assert.equal(graphqlErrors[0]?.scope, "github");
  assert.ok(graphqlCalls > 1, "the second page is what the dedupe is guarding");

  // Partial means partial: the rest of the fleet still renders.
  assert.equal(snapshot.projects.length, fleetConfig.repos.length);
});

test("togather's sync workflow offers every environment the workflow accepts", () => {
  const togather = fleetConfig.repos.find((repo) => repo.slug === "togathernyc/togather");
  // `both` is in the workflow's own choice list and is the value togather's
  // CLAUDE.md tells maintainers to use; omitting it hid a button.
  assert.deepEqual(togather?.secretsSyncEnvironments, ["staging", "production", "both"]);
});

test("no repo is configured with a sync workflow but no environments", () => {
  for (const repo of fleetConfig.repos) {
    if (repo.secretsSyncWorkflow === null) continue;
    assert.ok(repo.secretsSyncEnvironments.length > 0, `${repo.slug} lists no environment`);
  }
});
