import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_WINDOW_MS,
  describeDevice,
  prodState,
  readLocalMark,
  reconcileMarks,
  reviewLabel,
  windowFrom,
  writeLocalMark,
  type MarkStore,
  type ReviewMark,
} from "../src/lib/review";

/**
 * The marker, its two storage formats, and the rule that settles a disagreement
 * between two devices.
 */

const KEY = "fleet-dashboard:last-reviewed";
const MORNING = "2026-08-01T07:00:00.000Z";
const EVENING = "2026-08-01T19:00:00.000Z";

function store(initial: Record<string, string> = {}): MarkStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

test("a first-run browser has no mark", () => {
  assert.equal(readLocalMark(store()), null);
  assert.equal(readLocalMark(null), null);
});

test("a mark round-trips", () => {
  const s = store();
  const mark: ReviewMark = { lastReviewedAt: MORNING, updatedAt: 1000, device: "iPhone" };
  writeLocalMark(mark, s);
  assert.deepEqual(readLocalMark(s), mark);
});

/**
 * v2 wrote a bare ISO string under this key and that value is still sitting in
 * a browser. Reading it as epoch would let an empty backend beat a real review.
 */
test("v2's bare-timestamp format is still read, dated by its own timestamp", () => {
  const mark = readLocalMark(store({ [KEY]: MORNING }));
  assert.deepEqual(mark, {
    lastReviewedAt: MORNING,
    updatedAt: Date.parse(MORNING),
    device: "unknown",
  });
});

test("an unreadable stored value is a first run, not a crash", () => {
  for (const raw of ["", "   ", "not a date", "{not json", "[]", "null", JSON.stringify({})]) {
    assert.equal(readLocalMark(store({ [KEY]: raw })), null, `expected null for ${raw}`);
  }
});

test("a mark missing updatedAt is dated by its own timestamp", () => {
  const mark = readLocalMark(store({ [KEY]: JSON.stringify({ lastReviewedAt: MORNING }) }));
  assert.equal(mark?.updatedAt, Date.parse(MORNING));
  assert.equal(mark?.device, "unknown");
});

test("a storage that throws behaves like a first run", () => {
  const hostile: MarkStore = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
    removeItem() {
      throw new Error("denied");
    },
  };
  assert.equal(readLocalMark(hostile), null);
  assert.doesNotThrow(() =>
    writeLocalMark({ lastReviewedAt: MORNING, updatedAt: 1, device: "x" }, hostile),
  );
});

test("no mark opens one window back, not at the epoch", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  assert.equal(
    windowFrom(null, now),
    new Date(now.getTime() - DEFAULT_WINDOW_MS).toISOString(),
  );
});

test("a mark's window is its own timestamp", () => {
  assert.equal(windowFrom({ lastReviewedAt: MORNING, updatedAt: 1, device: "x" }), MORNING);
});

test("reconcile: neither side has a mark", () => {
  assert.deepEqual(reconcileMarks(null, null), { mark: null, push: false });
});

test("reconcile: a local mark with no remote is pushed", () => {
  const local: ReviewMark = { lastReviewedAt: MORNING, updatedAt: 1000, device: "iPhone" };
  assert.deepEqual(reconcileMarks(local, null), { mark: local, push: true });
});

test("reconcile: a remote mark with no local is adopted without a write", () => {
  const remote: ReviewMark = { lastReviewedAt: MORNING, updatedAt: 1000, device: "Mac" };
  assert.deepEqual(reconcileMarks(null, remote), { mark: remote, push: false });
});

test("reconcile: the newer updatedAt wins", () => {
  const local: ReviewMark = { lastReviewedAt: EVENING, updatedAt: 2000, device: "iPhone" };
  const remote: ReviewMark = { lastReviewedAt: MORNING, updatedAt: 1000, device: "Mac" };
  assert.deepEqual(reconcileMarks(local, remote), { mark: local, push: true });
  assert.deepEqual(reconcileMarks(remote, local), { mark: local, push: false });
});

/** A tie is the same mark coming home; preferring local would write on every load. */
test("reconcile: a tie keeps the remote and pushes nothing", () => {
  const local: ReviewMark = { lastReviewedAt: EVENING, updatedAt: 2000, device: "iPhone" };
  const remote: ReviewMark = { lastReviewedAt: MORNING, updatedAt: 2000, device: "Mac" };
  assert.deepEqual(reconcileMarks(local, remote), { mark: remote, push: false });
});

test("describeDevice names the obvious ones and degrades to unknown", () => {
  assert.equal(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iPhone");
  assert.equal(describeDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), "iPad");
  assert.equal(describeDevice("Mozilla/5.0 (Linux; Android 15)"), "Android");
  assert.equal(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "Mac");
  assert.equal(describeDevice("Mozilla/5.0 (Windows NT 10.0)"), "Windows");
  assert.equal(describeDevice(""), "unknown");
  assert.equal(describeDevice(null), "unknown");
  assert.equal(describeDevice("Something/1.0"), "browser");
});

test("reviewLabel and prodState are untouched by the marker's new shape", () => {
  assert.equal(reviewLabel(new Date("2026-08-01T09:00:00")), "morning review");
  assert.equal(reviewLabel(new Date("2026-08-01T19:00:00")), "evening review");
  assert.equal(prodState(MORNING, EVENING), "in-production");
  assert.equal(prodState(EVENING, MORNING), "awaiting-production");
  assert.equal(prodState(EVENING, null), "unknown");
});
