import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TRANSITIONS,
  BUG_STATUSES,
  canTransition,
  GITHUB_MERGEABLE_STATUSES,
  isTransitionAllowed,
  type BugStatus,
} from "../src/pipeline/statusMachine";

test("status machine: ALLOWED_TRANSITIONS matches the full expected map exactly", () => {
  // A representative forward/backward pair test can't catch a silently ADDED
  // forward edge (e.g. an extra DRAFT -> READY_FOR_IMPL skip) — only a full
  // snapshot of the map locks that down.
  assert.deepEqual(ALLOWED_TRANSITIONS, {
    DRAFT: ["IN_REVIEW", "REJECTED"],
    IN_REVIEW: ["READY_FOR_IMPL", "REJECTED"],
    READY_FOR_IMPL: ["IN_PROGRESS", "REJECTED"],
    IN_PROGRESS: ["CODE_REVIEW", "REJECTED"],
    CODE_REVIEW: ["READY_TO_MERGE", "MERGED", "REJECTED"],
    READY_TO_MERGE: ["MERGED", "REJECTED"],
    MERGED: ["READY_FOR_IMPL"],
    REJECTED: [],
  });
});

test("status machine: forward transitions are allowed", () => {
  assert.equal(canTransition("DRAFT", "IN_REVIEW"), true);
  assert.equal(canTransition("IN_REVIEW", "READY_FOR_IMPL"), true);
  assert.equal(canTransition("READY_FOR_IMPL", "IN_PROGRESS"), true);
  assert.equal(canTransition("IN_PROGRESS", "CODE_REVIEW"), true);
  assert.equal(canTransition("CODE_REVIEW", "READY_TO_MERGE"), true);
  assert.equal(canTransition("READY_TO_MERGE", "MERGED"), true);
});

test("status machine: CODE_REVIEW -> MERGED is a legal forward skip", () => {
  assert.equal(canTransition("CODE_REVIEW", "MERGED"), true);
});

test("status machine: backward transitions are forbidden", () => {
  assert.equal(canTransition("READY_TO_MERGE", "CODE_REVIEW"), false);
  assert.equal(canTransition("CODE_REVIEW", "IN_PROGRESS"), false);
  assert.equal(canTransition("IN_PROGRESS", "READY_FOR_IMPL"), false);
  assert.equal(canTransition("MERGED", "CODE_REVIEW"), false);
});

test("status machine: staging-redo MERGED -> READY_FOR_IMPL is the one cycle", () => {
  assert.equal(canTransition("MERGED", "READY_FOR_IMPL"), true);
  // ...but no other backward hop from MERGED.
  assert.equal(canTransition("MERGED", "IN_PROGRESS"), false);
  assert.equal(canTransition("MERGED", "READY_TO_MERGE"), false);
});

test("status machine: same-status is an idempotent re-apply", () => {
  for (const s of BUG_STATUSES) {
    assert.equal(canTransition(s, s), true);
  }
});

test("status machine: REJECTED is reachable from every non-terminal state and is terminal", () => {
  for (const s of BUG_STATUSES) {
    if (s === "REJECTED" || s === "MERGED") continue;
    assert.equal(
      canTransition(s, "REJECTED"),
      true,
      `${s} should allow -> REJECTED`,
    );
  }
  assert.deepEqual(ALLOWED_TRANSITIONS.REJECTED, []);
});

test("isTransitionAllowed: webhook/auto-merge may MERGE from any PR-live state", () => {
  for (const s of GITHUB_MERGEABLE_STATUSES) {
    assert.equal(isTransitionAllowed(s as BugStatus, "MERGED", "webhook"), true);
    assert.equal(
      isTransitionAllowed(s as BugStatus, "MERGED", "automerge"),
      true,
    );
  }
  // IN_PROGRESS -> MERGED is specifically allowed for GitHub sources...
  assert.equal(isTransitionAllowed("IN_PROGRESS", "MERGED", "webhook"), true);
  // ...but NOT via the monotonic map for a routine source.
  assert.equal(isTransitionAllowed("IN_PROGRESS", "MERGED", "routine"), false);
});

test("isTransitionAllowed: a routine-source MERGED follows the monotonic map only", () => {
  assert.equal(isTransitionAllowed("READY_TO_MERGE", "MERGED", "routine"), true);
  assert.equal(isTransitionAllowed("DRAFT", "MERGED", "routine"), false);
});

test("isTransitionAllowed: non-MERGED transitions ignore source", () => {
  assert.equal(isTransitionAllowed("DRAFT", "IN_REVIEW", "routine"), true);
  assert.equal(isTransitionAllowed("DRAFT", "IN_REVIEW", "webhook"), true);
  assert.equal(isTransitionAllowed("CODE_REVIEW", "IN_PROGRESS", "webhook"), false);
});
