"use strict";

/**
 * The phone↔watch rules, as checks rather than as a table in a design doc.
 *
 * Three of these describe failures that are invisible in a demo and obvious in
 * a corridor: a `start` delivered twenty minutes late, a flag stamped on
 * arrival instead of on the press, and a timer that keeps counting on the wrist
 * after the phone stopped talking.
 *
 * ## Sabotage record
 *
 *   live commands queued when unreachable                                1 failure
 *   `stampCommand` using the wall clock rather than session elapsed      3 failures
 *   the paused-session guard removed from `stampCommand`                 1 failure
 *   `presentState` counting a stale snapshot's timer as live             3 failures
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { TRANSPORTS, defineWatchBridge } = require("../src/index.js");

const bridge = defineWatchBridge({
  liveCommands: ["start", "stop", "pause", "resume"],
  queuedCommands: ["flag"],
});

test("each command kind gets the mechanism whose semantics it needs", () => {
  assert.equal(bridge.transportFor("start"), TRANSPORTS.live);
  assert.equal(bridge.transportFor("stop"), "sendMessage");
  assert.equal(bridge.transportFor("flag"), "transferUserInfo");
  assert.throws(() => bridge.transportFor("teleport"), /unknown watch command/);
});

test("a command is either live or queued, and that is decided once", () => {
  assert.throws(() => defineWatchBridge({ liveCommands: [] }), /at least one command/);
  assert.throws(
    () => defineWatchBridge({ liveCommands: ["flag"], queuedCommands: ["flag"] }),
    /either live or queued/,
  );
});

test("A LIVE COMMAND IS NOT QUEUED WHEN THE PHONE IS OUT OF RANGE", () => {
  // A `start` delivered twenty minutes late starts a recording nobody asked
  // for; a late `stop` ends one that already finished.
  for (const kind of ["start", "stop", "pause", "resume"]) {
    assert.deepEqual(bridge.deliverable(kind, { reachable: false }), { ok: false, why: "unreachable" }, kind);
    assert.deepEqual(bridge.deliverable(kind, { reachable: true }), { ok: true, transport: "sendMessage" }, kind);
  }
  assert.deepEqual(bridge.deliverable("start", null), { ok: false, why: "unreachable" });
});

test("a queued command survives the gap, because it is still true when it lands", () => {
  assert.deepEqual(bridge.deliverable("flag", { reachable: false }), { ok: true, transport: "transferUserInfo" });
});

test("A FLAG IS STAMPED AT THE PRESS, NOT ON ARRIVAL", () => {
  // The whole reason `flag` may be queued. A flag stamped on delivery points at
  // the wrong sentence, which is worse than no flag.
  const snapshot = { elapsedMs: 600_000, receivedAt: 10_000, running: true };
  const stamped = bridge.stampCommand("flag", { state: snapshot, now: 14_000 });
  assert.equal(stamped.atMs, 604_000, "ten minutes in, plus the four seconds since the snapshot");
  assert.equal(stamped.pressedAt, 14_000);
  assert.equal(stamped.kind, "flag");
});

test("a paused session's flag does not point past the end of the recording", () => {
  // Elapsed time does not advance while paused, so adding the wall-clock gap
  // would stamp the flag somewhere the recording never reached.
  const snapshot = { elapsedMs: 600_000, receivedAt: 10_000, running: false };
  assert.equal(bridge.stampCommand("flag", { state: snapshot, now: 90_000 }).atMs, 600_000);
});

test("a flag with no snapshot at all stamps the start rather than throwing", () => {
  assert.equal(bridge.stampCommand("flag", { state: null, now: 5_000 }).atMs, 0);
  assert.equal(bridge.stampCommand("flag", { state: {}, now: 5_000 }).atMs, 0);
});

test("a live command is not stampable — it has no meaning when late", () => {
  assert.throws(() => bridge.stampCommand("stop", { state: {}, now: 0 }), /is a live command/);
});

test("no session is a coherent screen, not an error", () => {
  // A watch app that shows "something went wrong" when the phone is simply in a
  // drawer is a watch app that fails review.
  const view = bridge.presentState(null, { now: 1_000, reachable: false });
  assert.deepEqual(view, { hasSession: false, live: false, stale: false, elapsedMs: 0, controlsEnabled: false });
});

test("a fresh snapshot counts on, and its controls work", () => {
  const view = bridge.presentState({ elapsedMs: 60_000, receivedAt: 100_000, running: true }, {
    now: 103_000,
    reachable: true,
  });
  assert.equal(view.live, true);
  assert.equal(view.stale, false);
  assert.equal(view.elapsedMs, 63_000, "the timer runs between snapshots");
  assert.equal(view.controlsEnabled, true);
});

test("A STALE SNAPSHOT'S TIMER STOPS PRESENTING ITSELF AS LIVE", () => {
  const view = bridge.presentState({ elapsedMs: 60_000, receivedAt: 100_000, running: true }, {
    now: 100_000 + 45_000,
    reachable: true,
  });
  assert.equal(view.stale, true);
  assert.equal(view.live, false);
  assert.equal(view.elapsedMs, 60_000, "last known, not a guess extrapolated 45 seconds forward");
  assert.equal(view.controlsEnabled, false, "and the controls go with it, so the screen is coherent");
});

test("an unreachable phone freezes the timer even when the snapshot is recent", () => {
  const view = bridge.presentState({ elapsedMs: 60_000, receivedAt: 100_000, running: true }, {
    now: 101_000,
    reachable: false,
  });
  assert.equal(view.live, false);
  assert.equal(view.stale, false, "recent, but not confirmed");
  assert.equal(view.controlsEnabled, false);
});

test("a paused session does not count on even while reachable and fresh", () => {
  const view = bridge.presentState({ elapsedMs: 60_000, receivedAt: 100_000, running: false }, {
    now: 103_000,
    reachable: true,
  });
  assert.equal(view.live, false);
  assert.equal(view.elapsedMs, 60_000);
  assert.equal(view.controlsEnabled, true, "but Resume is still pressable");
});

test("a snapshot with no arrival time is treated as infinitely old", () => {
  const view = bridge.presentState({ elapsedMs: 60_000 }, { now: 1_000, reachable: true });
  assert.equal(view.stale, true);
  assert.equal(view.ageMs, null);
  assert.equal(view.elapsedMs, 60_000);
});

test("the staleness window is configurable", () => {
  const patient = defineWatchBridge({ liveCommands: ["stop"], stalenessMs: 120_000 });
  const view = patient.presentState({ elapsedMs: 0, receivedAt: 0, running: true }, { now: 60_000, reachable: true });
  assert.equal(view.stale, false);
  assert.equal(patient.queued.length, 0, "queued commands are optional");
});
