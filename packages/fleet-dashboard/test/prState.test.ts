import assert from "node:assert/strict";
import { test } from "node:test";

import { derivePrState, needsYouReason, type PrSignals } from "../src/lib/prState";

const base: PrSignals = {
  isDraft: false,
  checkState: null,
  mergeable: "MERGEABLE",
  reviewDecision: null,
  hasRequestedReviewers: false,
};

test("PR state reports the most blocking signal first", () => {
  assert.equal(derivePrState({ ...base, isDraft: true, checkState: "FAILURE" }), "draft");
  assert.equal(derivePrState({ ...base, checkState: "FAILURE" }), "ci-failed");
  assert.equal(derivePrState({ ...base, checkState: "ERROR" }), "ci-failed");
  assert.equal(derivePrState({ ...base, checkState: "PENDING" }), "ci-running");
  assert.equal(derivePrState({ ...base, mergeable: "CONFLICTING" }), "conflict");
  assert.equal(derivePrState({ ...base, reviewDecision: "REVIEW_REQUIRED" }), "review");
  assert.equal(derivePrState({ ...base, hasRequestedReviewers: true }), "review");
  assert.equal(derivePrState(base), "mergeable");
});

test("an explicit review request from the owner lands in NEEDS YOU", () => {
  assert.equal(
    needsYouReason({ ...base, hasRequestedReviewers: true }, ["lilseyi"], "lilseyi", "someone-else"),
    "review requested from lilseyi",
  );
  // Case-insensitive, and a request to someone else is not yours to action.
  assert.equal(
    needsYouReason({ ...base, hasRequestedReviewers: true }, ["LilSeyi"], "lilseyi", null),
    "review requested from lilseyi",
  );
  assert.equal(
    needsYouReason({ ...base, hasRequestedReviewers: true }, ["someone-else"], "lilseyi", null),
    null,
  );
});

test("a missing required review on someone else's PR is yours to action", () => {
  assert.equal(
    needsYouReason({ ...base, reviewDecision: "REVIEW_REQUIRED" }, [], "lilseyi", "a-contributor"),
    "required review missing",
  );
  assert.equal(
    needsYouReason({ ...base, reviewDecision: "CHANGES_REQUESTED" }, [], "lilseyi", "a-contributor"),
    "changes requested",
  );
});

test("REVIEW_REQUIRED on your own PR is not actionable and must not be listed", () => {
  // GitHub returns REVIEW_REQUIRED for ANY non-draft PR under a rule requiring
  // approvals — including your own — and then forbids self-review. In a fleet
  // of agent-authored PRs opened on the owner's behalf, listing these would
  // fill the panel with rows nobody can clear.
  assert.equal(
    needsYouReason({ ...base, reviewDecision: "REVIEW_REQUIRED" }, [], "lilseyi", "lilseyi"),
    null,
  );
  assert.equal(
    needsYouReason({ ...base, reviewDecision: "CHANGES_REQUESTED" }, [], "lilseyi", "LILSEYI"),
    null,
  );
  // …but an explicit request still wins, since GitHub won't create one for
  // your own PR — if it exists, something deliberate made it.
  assert.equal(
    needsYouReason({ ...base, hasRequestedReviewers: true }, ["lilseyi"], "lilseyi", "lilseyi"),
    "review requested from lilseyi",
  );
});

test("drafts never appear, and an unknown author is treated as someone else", () => {
  assert.equal(
    needsYouReason({ ...base, isDraft: true, reviewDecision: "REVIEW_REQUIRED" }, [], "lilseyi", null),
    null,
  );
  assert.equal(
    needsYouReason({ ...base, reviewDecision: "REVIEW_REQUIRED" }, [], "lilseyi", null),
    "required review missing",
  );
});
