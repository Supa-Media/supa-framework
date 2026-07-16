import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCallbackPolicy,
  shouldIgnoreVerdict,
} from "../src/pipeline/callbackPolicy";

test("spec runs may only deliver IN_REVIEW", () => {
  assert.equal(
    checkCallbackPolicy({ source: "routine", mode: "spec", status: "IN_REVIEW" }),
    null,
  );
  assert.match(
    checkCallbackPolicy({
      source: "routine",
      mode: "spec",
      status: "CODE_REVIEW",
    })!,
    /spec run may not deliver status CODE_REVIEW/,
  );
});

test("spec runs may not carry a review verdict", () => {
  assert.match(
    checkCallbackPolicy({
      source: "routine",
      mode: "spec",
      status: "IN_REVIEW",
      reviewVerdict: "approved",
    })!,
    /spec run may not deliver a review verdict/,
  );
});

test("implement runs may deliver IN_PROGRESS or CODE_REVIEW, never READY_TO_MERGE", () => {
  assert.equal(
    checkCallbackPolicy({
      source: "routine",
      mode: "implement",
      status: "IN_PROGRESS",
    }),
    null,
  );
  assert.equal(
    checkCallbackPolicy({
      source: "routine",
      mode: "implement",
      status: "CODE_REVIEW",
    }),
    null,
  );
  assert.match(
    checkCallbackPolicy({
      source: "routine",
      mode: "implement",
      status: "READY_TO_MERGE",
    })!,
    /the review pipeline owns that promotion/,
  );
  assert.match(
    checkCallbackPolicy({
      source: "routine",
      mode: "implement",
      status: "MERGED",
    })!,
    /implement run may not deliver status MERGED/,
  );
});

test("review runs may only deliver CODE_REVIEW (verdict honored elsewhere)", () => {
  assert.equal(
    checkCallbackPolicy({
      source: "routine",
      mode: "review",
      status: "CODE_REVIEW",
      reviewVerdict: "approved",
    }),
    null,
  );
  assert.match(
    checkCallbackPolicy({
      source: "routine",
      mode: "review",
      status: "READY_TO_MERGE",
    })!,
    /review run may not deliver status READY_TO_MERGE/,
  );
});

test("fix runs may only deliver CODE_REVIEW", () => {
  assert.equal(
    checkCallbackPolicy({
      source: "routine",
      mode: "fix",
      status: "CODE_REVIEW",
    }),
    null,
  );
  assert.match(
    checkCallbackPolicy({ source: "routine", mode: "fix", status: "IN_REVIEW" })!,
    /fix run may not deliver status IN_REVIEW/,
  );
});

test("legacy (unset-mode) routine callbacks are permissive", () => {
  assert.equal(
    checkCallbackPolicy({
      source: "routine",
      mode: undefined,
      status: "READY_TO_MERGE",
    }),
    null,
  );
});

test("non-routine sources (webhook/automerge) are not policed here", () => {
  assert.equal(
    checkCallbackPolicy({ source: "webhook", mode: "spec", status: "MERGED" }),
    null,
  );
  assert.equal(
    checkCallbackPolicy({
      source: "automerge",
      mode: "review",
      status: "MERGED",
    }),
    null,
  );
});

test("only a fix run's verdict is ignored", () => {
  assert.equal(shouldIgnoreVerdict("routine", "fix"), true);
  assert.equal(shouldIgnoreVerdict("routine", "review"), false);
  assert.equal(shouldIgnoreVerdict("webhook", "fix"), false);
  assert.equal(shouldIgnoreVerdict("routine", undefined), false);
});
