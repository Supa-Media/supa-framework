import assert from "node:assert/strict";
import { test } from "node:test";

import { LABELS, labelsAfterKeep, initiativeLabels, sizeLabel } from "../src/lib/labels";
import { prodState } from "../src/lib/review";
import {
  selectDecisions,
  selectParked,
  selectPlan,
  selectQuestions,
  selectQueue,
} from "../src/lib/select";
import type { IssueCard, IssueComment } from "../src/sources/types";

function issue(partial: Partial<IssueCard> & { number: number }): IssueCard {
  const labels = partial.labels ?? [];
  return {
    id: `o/r#${partial.number}`,
    nodeId: `node-${partial.number}`,
    repoKey: "o/r",
    repoSlug: "o/r",
    repoLabel: "Repo",
    title: `issue ${partial.number}`,
    url: `https://github.com/o/r/issues/${partial.number}`,
    body: "",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
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

function comment(body: string, createdAt: string): IssueComment {
  return { url: "https://github.com/o/r/issues/1#c", body, createdAt, author: "bot" };
}

const SINCE = "2026-08-01T06:00:00Z";

test("decisions are scoped to comments written since the last review", () => {
  const issues = [
    issue({
      number: 1,
      comments: [
        comment("**[decider]** old call", "2026-08-01T05:00:00Z"),
        comment("**[decider]** new call\nconfidence: high", "2026-08-01T07:00:00Z"),
      ],
    }),
  ];

  const decisions = selectDecisions(issues, SINCE);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.block.headline, "new call");
});

test("decisions come back newest first, across issues", () => {
  const issues = [
    issue({ number: 1, comments: [comment("**[decider]** a", "2026-08-01T07:00:00Z")] }),
    issue({ number: 2, comments: [comment("**[decider]** b", "2026-08-01T09:00:00Z")] }),
  ];
  assert.deepEqual(
    selectDecisions(issues, SINCE).map((decision) => decision.block.headline),
    ["b", "a"],
  );
});

test("a park shows the newest context sheet, not the first", () => {
  const parked = selectParked([
    issue({
      number: 1,
      labels: [LABELS.blocked],
      comments: [
        comment("**[context-sheet]**\ntried: one", "2026-08-01T01:00:00Z"),
        comment("**[context-sheet]**\ntried: two", "2026-08-01T08:00:00Z"),
      ],
    }),
  ]);
  assert.equal(parked[0]?.sheet?.fields["tried"], "two");
});

test("a sheet written in the issue body counts when no comment carries one", () => {
  const parked = selectParked([
    issue({ number: 1, labels: [LABELS.blocked], body: "**[context-sheet]**\ntried: body" }),
  ]);
  assert.equal(parked[0]?.sheet?.fields["tried"], "body");
  assert.equal(parked[0]?.sheetUrl, "https://github.com/o/r/issues/1");
});

test("a park with no sheet at all is still listed", () => {
  const parked = selectParked([issue({ number: 1, labels: [LABELS.blocked] })]);
  assert.equal(parked.length, 1);
  assert.equal(parked[0]?.sheet, null);
  assert.equal(parked[0]?.sheetUrl, null);
});

test("questions come only from parked issues, one per issue", () => {
  const issues = [
    issue({
      number: 1,
      labels: [LABELS.blocked],
      comments: [
        comment("**[question]** old?\noptions: a | b", "2026-08-01T01:00:00Z"),
        comment("**[question]** new?\noptions: c | d", "2026-08-01T08:00:00Z"),
      ],
    }),
    // Not blocked: this agent asked and answered itself and moved on.
    issue({
      number: 2,
      labels: [LABELS.ready],
      comments: [comment("**[question]** stale?", "2026-08-01T08:00:00Z")],
    }),
  ];

  const questions = selectQuestions(issues);
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.block.headline, "new?");
});

test("today's plan is ready work that is not already approved", () => {
  const groups = selectPlan([
    issue({ number: 1, labels: [LABELS.ready] }),
    issue({ number: 2, labels: [LABELS.ready, LABELS.planApproved] }),
    issue({ number: 3, labels: [LABELS.blocked] }),
  ]);
  assert.deepEqual(
    groups[0]?.issues.map((item) => item.number),
    [1],
  );
});

test("the queue is approved work that no agent has picked up", () => {
  const groups = selectQueue([
    issue({ number: 1, labels: [LABELS.ready, LABELS.planApproved] }),
    issue({ number: 2, labels: [LABELS.planApproved, LABELS.inProgress] }),
    issue({ number: 3, labels: [LABELS.ready] }),
  ]);
  assert.deepEqual(
    groups[0]?.issues.map((item) => item.number),
    [1],
  );
});

test("keeping an inbox proposal preserves its init and size labels", () => {
  // The extractor writes `init:*`; dropping it on accept would strand the item
  // outside any initiative the moment you said yes to it.
  const after = labelsAfterKeep(
    [LABELS.inboxProposed, "init:giving", "size:M"].map((name) => ({ name })),
  );
  assert.deepEqual(after.sort(), [LABELS.ready, "init:giving", "size:M"].sort());
});

test("keeping is idempotent", () => {
  const after = labelsAfterKeep([LABELS.ready, "init:giving"].map((name) => ({ name })));
  assert.deepEqual(after, [LABELS.ready, "init:giving"]);
});

test("size labels normalize case; initiative labels keep theirs", () => {
  assert.equal(sizeLabel([{ name: "size:m" }]), "M");
  assert.deepEqual(initiativeLabels([{ name: "init:WA-Parity" }, { name: "init:" }]), ["WA-Parity"]);
});

test("production state never guesses when there is no deploy to compare", () => {
  assert.equal(prodState("2026-08-01T02:00:00Z", null), "unknown");
  assert.equal(prodState("2026-08-01T02:00:00Z", "not-a-date"), "unknown");
  assert.equal(prodState("2026-08-01T02:00:00Z", "2026-08-01T03:00:00Z"), "in-production");
  assert.equal(prodState("2026-08-01T04:00:00Z", "2026-08-01T03:00:00Z"), "awaiting-production");
  // A deploy at the same instant counts as having carried the merge.
  assert.equal(prodState("2026-08-01T03:00:00Z", "2026-08-01T03:00:00Z"), "in-production");
});
