import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { fleetConfig } from "../src/fleet.config";
import { fleetOwners, type TokenMap } from "../src/lib/tokens";
import { createGitHubSource } from "../src/sources/github/githubSource";

/**
 * The read half of the partial-success finding, plus the per-owner split.
 *
 * `snapshot.errors` drives the "Partial data — the rest of the page is still
 * accurate" banner. It used to be fed only from the `.catch()` around the fleet
 * query, which an `HTTP 200` never reaches — so a repo the token could not see
 * came back as a quietly short fleet with no banner and nothing naming the repo.
 *
 * The fleet query is now issued **once per resource owner**, since a
 * fine-grained PAT is scoped to one owner and one request carries one
 * `Authorization` header.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const OWNERS = fleetOwners(fleetConfig.repos);

/** A token for every owner in the fleet — "fully signed in". */
function allTokens(): TokenMap {
  return Object.fromEntries(OWNERS.map((group) => [group.owner, `token-${group.owner}`]));
}

const GRAPHQL_ERROR = "Could not resolve to a Repository with the name 'shyoh/fount-studios'.";

/**
 * A fleet payload for one owner's request. Aliases are positional **within that
 * owner's document**, so the count follows the owner's repo count, not the
 * fleet's.
 */
function ownerPayload(repoCount: number, hasNextPage: boolean, errors?: unknown[]): unknown {
  const data: Record<string, unknown> = {
    labelled: { issueCount: 0, nodes: [] },
    costIssues: { nodes: [] },
  };
  for (let index = 0; index < repoCount; index += 1) {
    data[`repo${index}`] = {
      issueCount: 0,
      pageInfo: { hasNextPage: index === 0 && hasNextPage, endCursor: "cursor-1" },
      nodes: [],
    };
    data[`merged${index}`] = { issueCount: 0, nodes: [] };
  }
  return errors === undefined ? { data } : { data, errors };
}

/** Which owner a GraphQL request was sent as, read from its bearer token. */
function ownerOfCall(init: RequestInit | undefined): string {
  const auth = new Headers(init?.headers).get("Authorization") ?? "";
  return auth.replace("Bearer token-", "");
}

test("a 200 with data and errors still fills the Partial-data banner, once", async () => {
  let graphqlCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/graphql")) {
      graphqlCalls += 1;
      const owner = ownerOfCall(init);
      const repoCount = OWNERS.find((group) => group.owner === owner)?.repos.length ?? 0;
      // Exactly GitHub's shape for a per-alias failure: 200, data AND errors.
      // Only shyoh's request fails, and it is asked twice (page 1 says there is
      // more) — the banner must still name it once.
      const failing = owner === "shyoh";
      return new Response(
        JSON.stringify(
          ownerPayload(
            repoCount,
            failing,
            failing ? [{ type: "NOT_FOUND", path: ["repo0"], message: GRAPHQL_ERROR }] : undefined,
          ),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // Everything REST is out of scope here and degrades per repo, as designed.
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  }) as typeof fetch;

  const snapshot = await createGitHubSource(fleetConfig, allTokens()).fetchFleet({
    since: "2026-08-01T00:00:00.000Z",
  });

  const graphqlErrors = snapshot.errors.filter((error) => error.message === GRAPHQL_ERROR);
  assert.equal(graphqlErrors.length, 1, "reported once, not once per pagination round-trip");
  // Scoped to the owner, not to "github": with three tokens in play, "the token
  // was rejected" is useless without saying whose.
  assert.equal(graphqlErrors[0]?.scope, "shyoh");
  assert.ok(graphqlCalls > OWNERS.length, "the second page is what the dedupe is guarding");

  // Partial means partial: the rest of the fleet still renders.
  assert.equal(snapshot.projects.length, fleetConfig.repos.length);
});

test("the fleet search is one request per owner, each carrying only that owner's repos", async () => {
  const documents: Array<{ owner: string; query: string; variables: Record<string, string> }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).endsWith("/graphql")) {
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    const owner = ownerOfCall(init);
    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, string>;
    };
    documents.push({ owner, ...body });
    const repoCount = OWNERS.find((group) => group.owner === owner)?.repos.length ?? 0;
    return new Response(JSON.stringify(ownerPayload(repoCount, false)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await createGitHubSource(fleetConfig, allTokens()).fetchFleet({
    since: "2026-08-01T00:00:00.000Z",
  });

  assert.equal(documents.length, OWNERS.length, "one round-trip per owner, not per repo");

  for (const group of OWNERS) {
    const document = documents.find((entry) => entry.owner === group.owner);
    assert.ok(document !== undefined, `${group.owner} was never asked`);

    // Per-repo aliasing survives the split: one search node per repo inside the
    // owner's document, so each still reports an exact `issueCount` and pages
    // on its own cursor.
    const searched = Object.entries(document.variables)
      .filter(([key]) => /^q\d+$/.test(key))
      .map(([, value]) => value);
    assert.equal(searched.length, group.repos.length);
    for (const repo of group.repos) {
      assert.ok(
        searched.some((query) => query.includes(`repo:${repo.slug} `)),
        `${repo.slug} missing from ${group.owner}'s document`,
      );
    }

    // And nobody else's repos leak in — a request signed with one owner's PAT
    // can only answer NOT_FOUND for another owner's repo.
    const foreign = fleetConfig.repos.filter(
      (repo) => !group.repos.some((own) => own.slug === repo.slug),
    );
    const scoped = [document.variables["issueQuery"], document.variables["labelQuery"], ...searched]
      .join(" ");
    for (const repo of foreign) {
      assert.ok(!scoped.includes(repo.slug), `${repo.slug} leaked into ${group.owner}'s document`);
    }
  }
});

test("an owner with no token costs its own repos and nothing else", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push(String(input));
    if (String(input).endsWith("/graphql")) {
      const owner = ownerOfCall(init);
      const repoCount = OWNERS.find((group) => group.owner === owner)?.repos.length ?? 0;
      return new Response(JSON.stringify(ownerPayload(repoCount, false)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // Enough REST shape for a repo to build without erroring; the point of the
    // test is which URLs are reached at all.
    const path = String(input);
    const body = path.includes("/contents/")
      ? []
      : { default_branch: "main", workflow_runs: [], secrets: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const tokens = allTokens();
  delete tokens["shyoh"];

  const snapshot = await createGitHubSource(fleetConfig, tokens).fetchFleet({
    since: "2026-08-01T00:00:00.000Z",
  });

  const fount = snapshot.projects.find((project) => project.owner === "shyoh");
  assert.ok(fount !== undefined);
  assert.equal(fount.tokenMissing, true, "the card must say so rather than render zeros");
  assert.ok(
    !asked.some((url) => url.includes("fount-studios")),
    "not one request may be made for a repo with no token",
  );

  // Partial sign-in is not a failure: everything else loaded, and nothing was
  // filed in the banner about the owner that was deliberately skipped.
  for (const project of snapshot.projects) {
    if (project.owner !== "shyoh") assert.equal(project.tokenMissing, false);
  }
  assert.deepEqual(
    snapshot.errors.filter((error) => error.scope === "shyoh"),
    [],
  );
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
