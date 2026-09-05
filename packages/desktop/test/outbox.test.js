/**
 * The queue holds work that has not reached a server, so the interesting cases
 * are the ones that only happen offline: a write that overtakes its
 * predecessor, an hour of typing, a refusal nothing can fix, and a full replay
 * when the connection comes back.
 *
 * ## Sabotage record
 *
 *   `next` ignoring kind order (returning any pending entry)             1 failure
 *   `queue` replacing a merging kind instead of merging it               1 failure
 *   `apply` retrying a non-retryable refusal instead of parking it       3 failures
 *   a parked entry un-parking when its content changes                   1 failure
 *   `backoffMs` growing without its 60s cap                              1 failure
 *   `normalize` trusting the bookkeeping fields it read off disk         1 failure
 */

import test from "node:test";
import assert from "node:assert/strict";
import { backoffMs, defineOutbox, mergeById } from "../src/index.js";

const outbox = defineOutbox({
  kinds: ["create", "chunks", "notes", "finish"],
  merge: { chunks: mergeById("id", "chunks", (a, b) => a.at - b.at) },
});

const at = (ms) => 1_700_000_000_000 + ms;

test("kinds and merges are checked when the queue is declared", () => {
  assert.throws(() => defineOutbox({ kinds: [] }), /at least one kind/);
  assert.throws(() => defineOutbox({ kinds: ["a", "a"] }), /must be unique/);
  assert.throws(() => defineOutbox({ kinds: ["a"], merge: { b: () => ({}) } }), /unknown kind/);
  assert.throws(() => outbox.queue(outbox.empty(), { subjectId: "s", kind: "nope", body: {}, now: 0 }), /unknown outbox kind/);
});

test("A SUBJECT'S ENTRIES DRAIN IN DECLARED ORDER", () => {
  // The failure this prevents: a `finish` overtaking its `chunks`, so the
  // server writes half the content and then answers every later attempt with
  // the thing it already wrote.
  let queue = outbox.empty();
  queue = outbox.queue(queue, { subjectId: "s1", kind: "finish", body: {}, now: at(0) });
  queue = outbox.queue(queue, { subjectId: "s1", kind: "notes", body: {}, now: at(1) });
  queue = outbox.queue(queue, { subjectId: "s1", kind: "create", body: {}, now: at(2) });

  const order = [];
  for (let i = 0; i < 3; i += 1) {
    const entry = outbox.next(queue, at(100));
    order.push(entry.kind);
    queue = outbox.apply(queue, entry.id, { ok: true }, at(100));
  }
  assert.deepEqual(order, ["create", "notes", "finish"]);
});

test("one subject's blocked head does not block another subject", () => {
  let queue = outbox.empty();
  queue = outbox.queue(queue, { subjectId: "s1", kind: "create", body: {}, now: at(0) });
  queue = outbox.queue(queue, { subjectId: "s2", kind: "create", body: {}, now: at(1) });
  queue = outbox.apply(queue, "s1:create", { ok: false, code: "forbidden", message: "no", retryable: false }, at(2));

  const next = outbox.next(queue, at(3));
  assert.equal(next.subjectId, "s2", "a parked meeting must not stop the next one going out");
  assert.equal(outbox.pendingFor(queue, "s1")[0].state, "parked");
});

test("an hour of typing is one write, and the newest content wins", () => {
  let queue = outbox.empty();
  for (let keystroke = 0; keystroke < 40; keystroke += 1) {
    queue = outbox.queue(queue, {
      subjectId: "s1",
      kind: "notes",
      body: { text: `draft ${keystroke}` },
      now: at(keystroke),
    });
  }
  assert.equal(queue.entries.length, 1);
  assert.deepEqual(queue.entries[0].body, { text: "draft 39" });
});

test("A MERGING KIND ACCUMULATES INSTEAD OF OVERWRITING ITSELF", () => {
  // Every chunk is content, and the last page of a transcript is not a superset
  // of the previous one. Keyed on a stable id so a replay collapses rather than
  // duplicating.
  let queue = outbox.empty();
  queue = outbox.queue(queue, { subjectId: "s1", kind: "chunks", body: { chunks: [{ id: "c2", at: 2 }] }, now: at(0) });
  queue = outbox.queue(queue, { subjectId: "s1", kind: "chunks", body: { chunks: [{ id: "c1", at: 1 }] }, now: at(1) });
  queue = outbox.queue(queue, {
    subjectId: "s1",
    kind: "chunks",
    body: { chunks: [{ id: "c1", at: 1, text: "corrected" }] },
    now: at(2),
  });

  assert.equal(queue.entries.length, 1);
  assert.deepEqual(queue.entries[0].body.chunks, [
    { id: "c1", at: 1, text: "corrected" },
    { id: "c2", at: 2 },
  ]);
});

test("A REFUSAL NOTHING CAN FIX PARKS THE ENTRY RATHER THAN DELETING IT", () => {
  let queue = outbox.empty();
  queue = outbox.queue(queue, { subjectId: "s1", kind: "create", body: { text: "irreplaceable" }, now: at(0) });
  queue = outbox.apply(
    queue,
    "s1:create",
    { ok: false, code: "forbidden", message: "that grant was revoked", retryable: false },
    at(5),
  );

  const [entry] = queue.entries;
  assert.equal(entry.state, "parked");
  assert.deepEqual(entry.body, { text: "irreplaceable" }, "the content survives the refusal");
  assert.equal(entry.parked.code, "forbidden");
  assert.equal(entry.parked.message, "that grant was revoked");
  assert.equal(entry.parked.noticedAt, at(5));
  assert.equal(outbox.next(queue, at(10_000_000)), null, "a parked entry is never re-offered");
});

test("a parked entry stays parked when its content changes", () => {
  // New content does not make a rejected grant acceptable, and un-parking on
  // every keystroke would hammer a server that has already said no.
  let queue = outbox.empty();
  queue = outbox.queue(queue, { subjectId: "s1", kind: "notes", body: { text: "a" }, now: at(0) });
  queue = outbox.apply(queue, "s1:notes", { ok: false, code: "invalid", message: "no", retryable: false }, at(1));
  queue = outbox.queue(queue, { subjectId: "s1", kind: "notes", body: { text: "b" }, now: at(2) });

  const [entry] = queue.entries;
  assert.equal(entry.state, "parked");
  assert.deepEqual(entry.body, { text: "b" }, "but the newer content is still kept");
});

test("a retryable failure backs off, and new content clears the backoff it earned", () => {
  let queue = outbox.empty();
  queue = outbox.queue(queue, { subjectId: "s1", kind: "notes", body: { text: "a" }, now: at(0) });
  queue = outbox.apply(queue, "s1:notes", { ok: false, code: "unavailable", message: "offline", retryable: true }, at(0));
  assert.equal(queue.entries[0].attempts, 1);
  assert.equal(queue.entries[0].nextAttemptAt, at(1_000));
  assert.equal(outbox.next(queue, at(500)), null);
  assert.notEqual(outbox.next(queue, at(1_000)), null);

  queue = outbox.queue(queue, { subjectId: "s1", kind: "notes", body: { text: "b" }, now: at(200) });
  assert.equal(queue.entries[0].attempts, 0, "the backoff belonged to content that no longer exists");
  assert.equal(queue.entries[0].nextAttemptAt, at(200));
});

test("backoff doubles and then stops, so a queue never stalls forever", () => {
  assert.equal(backoffMs(1), 1_000);
  assert.equal(backoffMs(2), 2_000);
  assert.equal(backoffMs(6), 32_000);
  assert.equal(backoffMs(7), 60_000, "capped rather than 64s");
  assert.equal(backoffMs(50), 60_000);
  assert.equal(backoffMs(0), 1_000);
  assert.equal(backoffMs(2, 0.5), 3_000, "jitter widens the wait rather than replacing it");
});

test("nothing is dropped to save space, and only a person deletes content", () => {
  let queue = outbox.empty();
  for (let subject = 0; subject < 500; subject += 1) {
    queue = outbox.queue(queue, { subjectId: `s${subject}`, kind: "create", body: {}, now: at(subject) });
  }
  assert.equal(queue.entries.length, 500, "no cap, no LRU, no compaction");
  assert.equal(outbox.pendingSubjects(queue), 500);

  queue = outbox.forget(queue, "s7");
  assert.equal(queue.entries.length, 499);
  assert.deepEqual(outbox.pendingFor(queue, "s7"), []);
});

test("a queue file that parses keeps every entry it can read", () => {
  const onDisk = {
    version: 1,
    entries: [
      { id: "s1:create", subjectId: "s1", kind: "create", body: { keep: true }, queuedAt: 1, updatedAt: 1, attempts: 0, state: "pending", nextAttemptAt: 1 },
      { id: "s2:create", subjectId: "s2", kind: "unknown-kind", body: {} },
      { id: "s3:create", subjectId: "s3", kind: "create", body: null },
      "not an entry",
      null,
    ],
  };
  const repaired = outbox.normalize(onDisk);
  assert.equal(repaired.entries.length, 1);
  assert.deepEqual(repaired.entries[0].body, { keep: true });
});

test("A HAND-EDITED CLOCK FIELD DRAINS RATHER THAN STICKING FOREVER", () => {
  // The silent failure this repairs: `nextAttemptAt: "soon"` compares false
  // against every clock, so `next` never offers the entry again — no error, no
  // log line, and somebody's content sits in the queue for good.
  const repaired = outbox.normalize({
    version: 1,
    entries: [
      {
        id: "s1:create",
        subjectId: "s1",
        kind: "create",
        body: { text: "irreplaceable" },
        queuedAt: "yesterday",
        updatedAt: null,
        attempts: "many",
        state: "whatever",
        nextAttemptAt: "soon",
      },
    ],
  });
  const [entry] = repaired.entries;
  assert.deepEqual(entry.body, { text: "irreplaceable" }, "the content is kept");
  assert.equal(entry.state, "pending", "an unrecognised state is not a park");
  assert.equal(entry.attempts, 0);
  assert.notEqual(outbox.next(repaired, 0), null, "and it is offered again");

  // A parked entry read back off disk is still parked.
  const parked = outbox.normalize({
    version: 1,
    entries: [{ id: "s1:create", subjectId: "s1", kind: "create", body: {}, state: "parked" }],
  });
  assert.equal(parked.entries[0].state, "parked");
  assert.equal(outbox.next(parked, 0), null);
});

test("a queue file that does not parse is replaced rather than trusted", () => {
  for (const raw of [undefined, null, "{}", 7, { version: 99, entries: [] }, { version: 1, entries: "no" }]) {
    assert.deepEqual(outbox.normalize(raw), { version: 1, entries: [] });
  }
});

test("the reducer never mutates what it was handed", () => {
  const original = outbox.empty();
  const queued = outbox.queue(original, { subjectId: "s1", kind: "create", body: {}, now: at(0) });
  assert.deepEqual(original.entries, [], "queueing must not reach back into the caller's copy");
  assert.notEqual(queued, original);
  assert.deepEqual(outbox.apply(queued, "s1:create", { ok: true }, at(1)).entries, []);
  assert.equal(queued.entries.length, 1);
});
