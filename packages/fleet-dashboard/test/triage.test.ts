import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENTIC_WORKFLOWS_LABEL,
  isManaged,
  LABELS,
  MANAGED_LABELS,
  initiativeLabels,
  sizeLabel,
} from "../src/lib/labels";
import { countTriageByRepo, selectTriage } from "../src/lib/select";
import { buildUntriagedQuery } from "../src/sources/github/queries";
import type { IssueCard } from "../src/sources/types";

/**
 * Triage — the surface for issues the fleet is not managing.
 *
 * The definition is label **absence**, which is the whole reason it lives in a
 * selector and not in the GraphQL: `init:*` is an open set that no search
 * qualifier can exclude, so the query narrows the bandwidth and this decides.
 */

function issue(partial: Partial<IssueCard> & { number: number }): IssueCard {
  const labels = partial.labels ?? [];
  return {
    id: `${partial.repoKey ?? "o/r"}#${partial.number}`,
    nodeId: `node-${partial.number}`,
    repoKey: "o/r",
    repoSlug: "o/r",
    repoLabel: "Repo",
    title: `issue ${partial.number}`,
    url: `https://github.com/o/r/issues/${partial.number}`,
    body: "",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    author: "someone",
    labels,
    initiatives: initiativeLabels(labels.map((name) => ({ name }))),
    size: sizeLabel(labels.map((name) => ({ name }))),
    automerge: labels.includes(LABELS.automerge),
    notify: labels.includes(LABELS.notify),
    planApproved: labels.includes(LABELS.planApproved),
    comments: [],
    ...partial,
  };
}

test("every label in the fleet's vocabulary counts as managed", () => {
  for (const label of MANAGED_LABELS) {
    assert.equal(isManaged([label]), true, label);
  }
  // Naming an initiative is a human saying where the work belongs, which is more
  // triage than most issues ever get.
  assert.equal(isManaged(["init:giving"]), true);
  assert.equal(isManaged([]), false);
});

test("a size label alone is a measurement, not a decision", () => {
  // Someone sized it and then dropped it — exactly the shape triage exists for.
  assert.equal(isManaged(["size:M"]), false);
  assert.equal(isManaged(["bug", "needs-design"]), false);
});

test("untriaged is defined by absence, so a repo's own labels do not rescue it", () => {
  const triage = selectTriage([
    issue({ number: 1 }),
    issue({ number: 2, labels: ["bug", "priority: high"] }),
    issue({ number: 3, labels: [LABELS.ready] }),
    issue({ number: 4, labels: [LABELS.triaged] }),
    issue({ number: 5, labels: ["init:giving"] }),
    issue({ number: 6, labels: [LABELS.watchdogReport] }),
  ]);

  assert.deepEqual(
    triage.work.map((item) => item.number),
    [1, 2],
  );
  assert.deepEqual(triage.automation, []);
});

test("the automation's own reports are split out, not hidden and not queued", () => {
  const triage = selectTriage([
    issue({ number: 1, author: "lilseyi" }),
    issue({
      number: 2,
      author: "github-actions",
      labels: [AGENTIC_WORKFLOWS_LABEL],
    }),
    // REST and the web UI spell the same bot differently from GraphQL.
    issue({
      number: 3,
      author: "github-actions[bot]",
      labels: [AGENTIC_WORKFLOWS_LABEL],
    }),
    // The bot filing a normal issue is still product work.
    issue({ number: 4, author: "github-actions" }),
    // A human's issue carrying the label is not an operational report.
    issue({ number: 5, author: "lilseyi", labels: [AGENTIC_WORKFLOWS_LABEL] }),
  ]);

  assert.deepEqual(
    triage.work.map((item) => item.number).sort(),
    [1, 4, 5],
  );
  assert.deepEqual(
    triage.automation.map((item) => item.number).sort(),
    [2, 3],
  );
});

test("a deleted author never makes an issue look like automation", () => {
  const triage = selectTriage([
    issue({ number: 1, author: null, labels: [AGENTIC_WORKFLOWS_LABEL] }),
  ]);
  assert.equal(triage.work.length, 1);
  assert.equal(triage.automation.length, 0);
});

test("triage rows are newest-filed first", () => {
  const triage = selectTriage([
    issue({ number: 1, createdAt: "2026-07-01T00:00:00Z" }),
    issue({ number: 2, createdAt: "2026-08-01T00:00:00Z" }),
    issue({ number: 3, createdAt: "2026-07-15T00:00:00Z" }),
  ]);
  assert.deepEqual(
    triage.work.map((item) => item.number),
    [2, 3, 1],
  );
});

test("scoping to a repo is what the app view's section reads", () => {
  const issues = [
    issue({ number: 1, repoKey: "o/a", id: "o/a#1" }),
    issue({ number: 2, repoKey: "o/b", id: "o/b#2" }),
  ];
  assert.deepEqual(
    selectTriage(issues, "o/a").work.map((item) => item.repoKey),
    ["o/a"],
  );
  assert.equal(selectTriage(issues, "o/nothing").work.length, 0);
});

test("the Review count is the sum of the per-app badges, and excludes automation", () => {
  const issues = [
    issue({ number: 1, repoKey: "o/a", id: "o/a#1" }),
    issue({ number: 2, repoKey: "o/a", id: "o/a#2" }),
    issue({ number: 3, repoKey: "o/b", id: "o/b#3" }),
    issue({ number: 4, repoKey: "o/c", id: "o/c#4", labels: [LABELS.ready] }),
    // Operational: shown on the app view in its own collapsed row, never badged.
    issue({
      number: 5,
      repoKey: "o/a",
      id: "o/a#5",
      author: "github-actions",
      labels: [AGENTIC_WORKFLOWS_LABEL],
    }),
  ];

  const counts = countTriageByRepo(issues);
  assert.deepEqual([...counts.entries()].sort(), [
    ["o/a", 2],
    ["o/b", 1],
  ]);
  assert.equal(counts.get("o/c"), undefined, "a badge of 0 is noise; the nav renders nothing");

  // What the Review band prints: "N untriaged across the fleet".
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  assert.equal(total, 3);
  assert.equal(total, selectTriage(issues).work.length);
});

/* ── The GraphQL half ───────────────────────────────────────────────────── */

test("the untriaged search excludes every managed label, one qualifier each", () => {
  const query = buildUntriagedQuery(["o/a", "o/b"]);

  for (const label of MANAGED_LABELS) {
    // Repeated `-label:` qualifiers AND, which is what "carries none of them"
    // means. A single negated comma-list would be a negated OR.
    assert.ok(query.includes(`-label:"${label}"`), `missing exclusion for ${label}`);
  }
  // Quoted for the same reason `buildLabelQuery` quotes: a label name may carry
  // a space or a `/`, and unquoted those terminate the qualifier.
  assert.ok(!/-label:[^"]/.test(query), "every exclusion is quoted");
});

test("the untriaged search is open issues only, scoped to the owner's repos", () => {
  const query = buildUntriagedQuery(["o/a", "o/b"]);

  // `is:issue` is load-bearing: the ISSUE search type covers PRs too, and every
  // hand-opened PR carries none of these labels.
  assert.ok(query.includes("is:issue"));
  assert.ok(query.includes("is:open"));
  assert.ok(query.includes("sort:updated-desc"));
  assert.ok(query.includes("repo:o/a"));
  assert.ok(query.includes("repo:o/b"));
  assert.ok(!query.includes("repo:o/c"));
});

test("init:* is deliberately not in the query, because it cannot be", () => {
  // An open set has no exclusion qualifier. The selector is what drops these,
  // and this test is the reminder that the two halves are not the same list.
  const query = buildUntriagedQuery(["o/a"]);
  assert.ok(!query.includes("init:"), "no attempt to exclude an open label set");
  assert.equal(isManaged(["init:giving"]), true, "the selector still drops it");
});
