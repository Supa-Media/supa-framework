import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDecision,
  buildKeyboard,
  encodeCallback,
  parseCallback,
  parseQueueCommand,
  CALLBACK_DATA_MAX_BYTES,
  type Proposal,
} from "../src/callback";
import { FLEET_APPS } from "../src/fleet";

test("callback data round-trips", () => {
  const payload = { action: "keep", appKey: "events-os", issueNumber: 412 } as const;
  assert.equal(encodeCallback(payload), "k|events-os|412");
  assert.deepEqual(parseCallback("k|events-os|412"), payload);
  assert.deepEqual(parseCallback("r|togather|7"), {
    action: "reject",
    appKey: "togather",
    issueNumber: 7,
  });
});

test("every fleet app fits Telegram's 64-byte callback_data limit", () => {
  // Telegram silently rejects an over-long payload at send time — a keyboard
  // that just doesn't work, with no error to trace. This is the guard.
  for (const app of FLEET_APPS) {
    const encoded = encodeCallback({
      action: "reject",
      appKey: app.key,
      issueNumber: 999_999,
    });
    assert.ok(
      new TextEncoder().encode(encoded).length <= CALLBACK_DATA_MAX_BYTES,
      `${app.key} encodes too long`,
    );
  }
});

test("encoding an over-long payload throws rather than shipping a dead button", () => {
  assert.throws(
    () => encodeCallback({ action: "keep", appKey: "x".repeat(70), issueNumber: 1 }),
    /exceeds 64 bytes/,
  );
});

test("malformed callback data is rejected, not coerced", () => {
  for (const bad of [
    undefined,
    "",
    "k|togather",
    "k|togather|1|extra",
    "z|togather|1",
    "k||1",
    "k|togather|0",
    "k|togather|-3",
    "k|togather|12abc",
    "k|togather|1.5",
  ]) {
    assert.equal(parseCallback(bad), null, `expected null for ${String(bad)}`);
  }
});

const proposals: Proposal[] = [
  { appKey: "togather", issueNumber: 10, issueUrl: "https://x/10", title: "One" },
  { appKey: "events-os", issueNumber: 20, issueUrl: "https://x/20", title: "Two" },
];

test("the keyboard gives each proposal keep / reject / edit", () => {
  const keyboard = buildKeyboard(proposals);
  assert.equal(keyboard.length, 2);
  assert.equal(keyboard[0]?.length, 3);
  assert.equal(keyboard[0]?.[0]?.text, "1 ✅ keep");
  assert.equal(keyboard[0]?.[0]?.callback_data, "k|togather|10");
  assert.equal(keyboard[0]?.[1]?.callback_data, "r|togather|10");
  // ✏️ is a link, not a callback — editing happens on GitHub.
  assert.equal(keyboard[0]?.[2]?.url, "https://x/10");
  assert.equal(keyboard[0]?.[2]?.callback_data, undefined);
});

test("a decision appends an audit line and removes only that row", () => {
  const keyboard = buildKeyboard(proposals);
  const outcome = applyDecision(
    "Proposed 2 items.",
    keyboard,
    { action: "keep", appKey: "togather", issueNumber: 10 },
    "Let a leader pin a thread",
  );

  assert.equal(outcome.text, "Proposed 2 items.\n✅ kept #10 — Let a leader pin a thread");
  assert.equal(outcome.keyboard.length, 1);
  assert.equal(outcome.keyboard[0]?.[0]?.callback_data, "k|events-os|20");
});

test("rejection is recorded with its own marker", () => {
  const outcome = applyDecision(
    "Proposed 2 items.",
    buildKeyboard(proposals),
    { action: "reject", appKey: "events-os", issueNumber: 20 },
    "Two",
  );
  assert.match(outcome.text, /❌ rejected #20 — Two/);
  assert.equal(outcome.keyboard.length, 1);
});

test("pressing a button for an already-decided item changes nothing", () => {
  const keyboard = buildKeyboard(proposals);
  const first = applyDecision(
    "Proposed 2 items.",
    keyboard,
    { action: "keep", appKey: "togather", issueNumber: 10 },
    "One",
  );
  const second = applyDecision(
    first.text,
    first.keyboard,
    { action: "keep", appKey: "togather", issueNumber: 10 },
    "One",
  );

  assert.equal(second.text, first.text, "no duplicate audit line");
  assert.deepEqual(second.keyboard, first.keyboard);
});

test("rows are matched by payload, not by position", () => {
  const keyboard = buildKeyboard(proposals);
  const outcome = applyDecision(
    "x",
    keyboard,
    { action: "keep", appKey: "events-os", issueNumber: 20 },
    "Two",
  );
  // The second row went, the first stayed — an index-based implementation
  // would have removed the wrong one.
  assert.equal(outcome.keyboard[0]?.[0]?.callback_data, "k|togather|10");
});

test("queue: is a fast path, and only when it is the prefix", () => {
  assert.equal(parseQueueCommand("queue: fix the RSVP badge"), "fix the RSVP badge");
  assert.equal(parseQueueCommand("QUEUE:   fix it  "), "fix it");
  assert.equal(parseQueueCommand("  queue : fix it"), "fix it");
  assert.equal(parseQueueCommand("queue: line one\nline two"), "line one\nline two");
});

test("queue: with nothing after it, or mid-sentence, is not a command", () => {
  assert.equal(parseQueueCommand("queue:"), null);
  assert.equal(parseQueueCommand("queue:   "), null);
  assert.equal(parseQueueCommand("we should queue: this later"), null);
  assert.equal(parseQueueCommand("just some text"), null);
  assert.equal(parseQueueCommand(undefined), null);
});
