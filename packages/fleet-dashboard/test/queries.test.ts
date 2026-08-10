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
  const query = buildFleetQuery([0, 1, 2], true);

  // One alias per repo — not one search with several `repo:` qualifiers, which
  // is what made the old 5-qualifier cap a silent cliff.
  for (const i of [0, 1, 2]) {
    assert.ok(query.includes(`repo${i}: search(query: $q${i}, type: ISSUE`), `alias repo${i}`);
    assert.ok(query.includes(`$q${i}: String!, $after${i}: String`), `variables for repo${i}`);
  }
  assert.ok(!query.includes("repo3:"), "no alias beyond the repo count");
});

test("the search node asks for the count and the cursor, not just nodes", () => {
  const query = buildFleetQuery([0], true);

  // `issueCount` is what makes the project card's number exact even when the
  // node list is capped; without `pageInfo` there is no pagination at all.
  assert.ok(query.includes("issueCount"));
  assert.ok(query.includes("hasNextPage"));
  assert.ok(query.includes("endCursor"));
  assert.ok(query.includes("first: 100"));
  assert.ok(MAX_PR_PAGES >= 2, "a cap of 1 page cannot paginate");
});

test("a later page asks only for the repos still paginating", () => {
  // Repo 1 finished on page one. Asking for it again replays its `null` cursor
  // and hands back page one, which the caller then has to recognize as a
  // duplicate — so the document simply does not carry it.
  const page2 = buildFleetQuery([0, 2], false);

  assert.ok(page2.includes("repo0: search"));
  assert.ok(page2.includes("repo2: search"));
  assert.ok(!page2.includes("repo1:"), "a finished repo must not be re-asked");

  // And the once-per-owner searches stay on page one: re-fetching 100 labelled
  // plus 100 untriaged issues per page, to drop them, is the bulk of the cost.
  for (const alias of ["labelled:", "untriaged:", "costIssues:", "merged0:"]) {
    assert.ok(!page2.includes(alias), `${alias} belongs to the first page only`);
  }
  // GraphQL rejects a document declaring a fragment or a variable it never
  // uses, so the fragments have to follow the same switch as the nodes.
  assert.ok(!page2.includes("fragment IssueFields"));
  assert.ok(!page2.includes("fragment MergedFields"));
  assert.ok(!page2.includes("$labelQuery"));
  assert.ok(!page2.includes("$m0"));
  assert.ok(page2.includes("fragment PullFields"));
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
  const query = buildFleetQuery([0, 1], true);

  // One node, one variable — so the whole triage surface costs zero extra HTTP
  // requests, and one extra search per owner rather than one per repo.
  assert.ok(query.includes("untriaged: search(query: $untriagedQuery, type: ISSUE"));
  assert.ok(query.includes("$untriagedQuery: String!"));
  assert.equal(query.split("untriaged: search").length - 1, 1, "one search, not one per repo");
  assert.ok(query.includes(`first: ${MAX_UNTRIAGED}`));
});

test("the untriaged node asks for the fields triage rows read, and no more", () => {
  const query = buildFleetQuery([0], true);

  // A triage row reads a title, an age, an author and the labels the issue does
  // NOT carry. Reusing IssueFields bought a body and the last 20 comments for
  // every one of a hundred issues per owner, rendered nowhere.
  assert.ok(query.includes("fragment TriageFields on Issue"));
  assert.ok(query.includes("...TriageFields"));

  const fragment = query.slice(
    query.indexOf("fragment TriageFields on Issue"),
    query.indexOf("query FleetPulse"),
  );
  assert.ok(!fragment.includes("comments("), "comments are the expensive half");
  assert.ok(!/^\s*body$/m.test(fragment), "no body either");
  assert.ok(fragment.includes("labels("), "labels are the whole definition of untriaged");
  assert.ok(fragment.includes("login"), "the author splits automation reports out");
});

test("the untriaged node asks for issueCount, like every other search since #40", () => {
  // Same convention as `labelled`: unpaginated, but the exact count is asked for
  // so a caller can never mistake a capped node list for a total.
  const untriaged = buildFleetQuery([0], true).slice(buildFleetQuery([0], true).indexOf("untriaged: search"));
  assert.ok(untriaged.slice(0, 200).includes("issueCount"));
});

test("issue fields carry the author, which is what splits automation reports out", () => {
  assert.ok(buildFleetQuery([0], true).includes("fragment IssueFields on Issue"));
  assert.ok(/fragment IssueFields on Issue \{[\s\S]*?author \{\s*login/.test(buildFleetQuery([0], true)));
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
