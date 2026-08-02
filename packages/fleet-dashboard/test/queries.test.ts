import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFleetQuery,
  buildIssueQuery,
  buildPrQuery,
  MAX_PR_PAGES,
  MAX_UNTRIAGED,
} from "../src/sources/github/queries";

test("each repo gets its own aliased, cursored search node", () => {
  const query = buildFleetQuery(3);

  // One alias per repo — not one search with several `repo:` qualifiers, which
  // is what made the old 5-qualifier cap a silent cliff.
  for (const i of [0, 1, 2]) {
    assert.ok(query.includes(`repo${i}: search(query: $q${i}, type: ISSUE`), `alias repo${i}`);
    assert.ok(query.includes(`$q${i}: String!, $after${i}: String`), `variables for repo${i}`);
  }
  assert.ok(!query.includes("repo3:"), "no alias beyond the repo count");
});

test("the search node asks for the count and the cursor, not just nodes", () => {
  const query = buildFleetQuery(1);

  // `issueCount` is what makes the project card's number exact even when the
  // node list is capped; without `pageInfo` there is no pagination at all.
  assert.ok(query.includes("issueCount"));
  assert.ok(query.includes("hasNextPage"));
  assert.ok(query.includes("endCursor"));
  assert.ok(query.includes("first: 100"));
  assert.ok(MAX_PR_PAGES >= 2, "a cap of 1 page cannot paginate");
});

test("PR search is scoped to one repo and sorted by recency", () => {
  const query = buildPrQuery("owner/name");

  assert.ok(query.includes("repo:owner/name"));
  assert.ok(query.includes("is:pr"));
  assert.ok(query.includes("is:open"));
  // So that if the page cap is ever hit, the PRs kept are the active ones.
  assert.ok(query.includes("sort:updated-desc"));
});

test("triage rides inside the owner's document as one more aliased search", () => {
  const query = buildFleetQuery(2);

  // One node, one variable — so the whole triage surface costs zero extra HTTP
  // requests, and one extra search per owner rather than one per repo.
  assert.ok(query.includes("untriaged: search(query: $untriagedQuery, type: ISSUE"));
  assert.ok(query.includes("$untriagedQuery: String!"));
  assert.equal(query.split("untriaged: search").length - 1, 1, "one search, not one per repo");
  assert.ok(query.includes(`first: ${MAX_UNTRIAGED}`));
});

test("the untriaged node asks for issueCount, like every other search since #40", () => {
  // Same convention as `labelled`: unpaginated, but the exact count is asked for
  // so a caller can never mistake a capped node list for a total.
  const untriaged = buildFleetQuery(1).slice(buildFleetQuery(1).indexOf("untriaged: search"));
  assert.ok(untriaged.slice(0, 200).includes("issueCount"));
});

test("issue fields carry the author, which is what splits automation reports out", () => {
  assert.ok(buildFleetQuery(1).includes("fragment IssueFields on Issue"));
  assert.ok(/fragment IssueFields on Issue \{[\s\S]*?author \{\s*login/.test(buildFleetQuery(1)));
});

test("the cost-issue search excludes closed and stale reports", () => {
  const query = buildIssueQuery(["o/a", "o/b"]);

  // Without is:open, closed reports match; without the sort, `first: 20`
  // returns an unordered slice of a weekly series.
  assert.ok(query.includes("is:open"));
  assert.ok(query.includes("sort:updated-desc"));
  assert.ok(query.includes("repo:o/a"));
  assert.ok(query.includes("repo:o/b"));
  // The `&` and `[]` in the real title break GitHub search syntax, so the
  // title match deliberately happens client-side instead.
  assert.ok(!query.includes("&"), "no raw & in a search query");
});
