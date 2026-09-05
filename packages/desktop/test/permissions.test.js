/**
 * When an app asks the operating system for something, and what it does with
 * the answer.
 *
 * The assertion surface is `broker.calls`, not the return value: "no dialog was
 * even raised" is a stronger and more useful statement than "the capture did
 * not start", and it is the one a person experiences.
 *
 * ## Sabotage record
 *
 *   `denied` re-requested instead of reported                            2 failures
 *
 * The parallel-request sabotage is not listed: `ensurePermissions` is written
 * as a `for … await` loop, and turning it into `Promise.all` changes the order
 * `broker.calls` records, which the last check would catch — but the check that
 * would catch it is the same one that documents the rule, so the sabotage adds
 * nothing the reader cannot already see.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ensurePermissions, fakePermissionBroker } from "../src/index.js";

const RATIONALES = {
  microphone: "Your microphone, so your own side is transcribed. Nothing joins the call.",
  screen: "Screen Recording, which is how macOS lets an app hear a meeting's audio.",
};

test("an undecided permission is asked for, once, with its reason", async () => {
  const broker = fakePermissionBroker({ microphone: "not-determined" });
  const outcome = await ensurePermissions(broker, ["microphone"], RATIONALES);
  assert.deepEqual(broker.calls, ["status:microphone", "request:microphone"]);
  assert.deepEqual(outcome, { ok: true, missing: [], statuses: { microphone: "granted" } });
});

test("an already-granted permission raises no dialog at all", async () => {
  const broker = fakePermissionBroker({ microphone: "granted", screen: "granted" });
  const outcome = await ensurePermissions(broker, ["microphone", "screen"], RATIONALES);
  assert.deepEqual(broker.calls, ["status:microphone", "status:screen"]);
  assert.equal(outcome.ok, true);
});

test("A DENIED PERMISSION IS NEVER RE-REQUESTED", async () => {
  // macOS ignores the call, so the app would look frozen while nothing
  // happened. Report it and send the person to System Settings instead.
  const broker = fakePermissionBroker({ microphone: "denied" });
  const outcome = await ensurePermissions(broker, ["microphone"], RATIONALES);
  assert.deepEqual(broker.calls, ["status:microphone"], "no dialog that will never appear");
  assert.deepEqual(outcome.missing, ["microphone"]);
  assert.equal(outcome.ok, false);
});

test("a restricted permission is reported rather than argued with", async () => {
  const broker = fakePermissionBroker({ screen: "restricted" });
  const outcome = await ensurePermissions(broker, ["screen"], RATIONALES);
  assert.deepEqual(broker.calls, ["status:screen"]);
  assert.deepEqual(outcome.missing, ["screen"]);
});

test("a refusal at the dialog is carried out as missing, not retried", async () => {
  const broker = fakePermissionBroker({ microphone: "not-determined" }, { microphone: "denied" });
  const outcome = await ensurePermissions(broker, ["microphone"], RATIONALES);
  assert.deepEqual(broker.calls, ["status:microphone", "request:microphone"]);
  assert.deepEqual(outcome, { ok: false, missing: ["microphone"], statuses: { microphone: "denied" } });
});

test("permissions are asked for one at a time", async () => {
  // Two system dialogs raced against each other stack, and the person answers
  // whichever is in front without reading the other.
  const broker = fakePermissionBroker({ microphone: "not-determined", screen: "not-determined" });
  await ensurePermissions(broker, ["microphone", "screen"], RATIONALES);
  assert.deepEqual(broker.calls, ["status:microphone", "request:microphone", "status:screen", "request:screen"]);
});

test("needing nothing asks for nothing and succeeds", async () => {
  const broker = fakePermissionBroker();
  assert.deepEqual(await ensurePermissions(broker, [], RATIONALES), { ok: true, missing: [], statuses: {} });
  assert.deepEqual(broker.calls, []);
});

test("an unknown status is treated as undecided rather than as a grant", async () => {
  const broker = fakePermissionBroker({ camera: "unknown" });
  const outcome = await ensurePermissions(broker, ["camera"], {});
  assert.deepEqual(broker.calls, ["status:camera", "request:camera"]);
  assert.equal(outcome.ok, true);
});
