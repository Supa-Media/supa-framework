/**
 * The menu bar is the whole always-on interface, so it cannot lie.
 *
 * One property here is load-bearing: the indicator is on for every state in
 * which something privileged is open. `../src/electron/tray.js` draws whatever
 * `present()` returns, so a state that forgot its indicator would be a live
 * microphone with nothing on screen to say so.
 *
 * `defineTray` makes that structural rather than tested — a state declares
 * `capturing` and the indicator is derived — so the checks below assert two
 * things at once: that the derivation holds for the states an app declares, and
 * that an app *cannot* declare them apart.
 *
 * ## Sabotage record
 *
 *   `present` returning a state's own `indicator` if it has one          1 failure
 *   the `"indicator" in state` guard removed from `defineTray`           1 failure
 *   `formatElapsed` clamping removed (`Math.max(0, …)`)                  1 failure
 */

import test from "node:test";
import assert from "node:assert/strict";
import { defineTray, formatElapsed } from "../src/index.js";

const tray = defineTray({
  states: {
    idle: { icon: "idle", tooltip: () => "Not watching" },
    armed: { icon: "armed", tooltip: () => "Watching" },
    detected: { icon: "detected", tooltip: (i) => `${i.title ?? "Something"} — waiting for you` },
    recording: {
      icon: "recording",
      capturing: true,
      title: (i) => formatElapsed(i.elapsedMs ?? 0),
      tooltip: (i) => `Recording ${i.title ?? "this"}`,
    },
    finalizing: {
      icon: "recording",
      capturing: true,
      title: (i) => formatElapsed(i.elapsedMs ?? 0),
      tooltip: (i) => `Writing up ${i.title ?? "this"}`,
    },
  },
  suffix: (i) => (i.pending ? ` · ${i.pending} waiting to save` : ""),
});

test("NO STATE IS CAPTURING WITHOUT AN INDICATOR, AND NONE IS INDICATING WITHOUT CAPTURING", () => {
  // The sweep rather than the case: this is what would catch a sixth state
  // added later that forgot.
  for (const name of tray.states) {
    const presentation = tray.present({ state: name });
    assert.equal(
      presentation.indicator,
      tray.capturingStates.includes(name),
      `${name} indicator must match its capturing flag`,
    );
  }
  assert.deepEqual(tray.capturingStates, ["recording", "finalizing"]);
});

test("a state cannot be declared with an indicator of its own", () => {
  // There is no quiet mode, and this is where that is enforced: an app that
  // could set `indicator` independently could ship one.
  assert.throws(
    () => defineTray({ states: { sneaky: { icon: "x", capturing: true, indicator: false, tooltip: () => "" } } }),
    /may not declare an indicator/,
  );
});

test("a tray declaration is checked when it is written, not when it is drawn", () => {
  assert.throws(() => defineTray({ states: {} }), /at least one state/);
  assert.throws(() => defineTray({ states: { a: { icon: "a" } } }), /needs a tooltip function/);
  assert.throws(() => defineTray({ states: { a: { tooltip: () => "" } } }), /needs an icon name/);
  assert.throws(() => tray.present({ state: "nope" }), /unknown tray state/);
});

test("the elapsed timer is what a forgotten recording announces itself with", () => {
  const recording = tray.present({ state: "recording", elapsedMs: 42_000, title: "Design review" });
  assert.equal(recording.title, "00:42");
  assert.equal(recording.tooltip, "Recording Design review");
  assert.equal(recording.icon, "recording");
  assert.equal(recording.indicator, true);

  // States with no title function render an empty one rather than `undefined`.
  assert.equal(tray.present({ state: "idle" }).title, "");
});

test("the suffix reaches every state, so none has to remember it", () => {
  for (const name of tray.states) {
    assert.match(tray.present({ state: name, pending: 3 }).tooltip, / · 3 waiting to save$/);
  }
  assert.equal(tray.present({ state: "armed" }).tooltip, "Watching");
});

test("elapsed time is tabular and never prints nonsense", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(12 * 60_000 + 4_000), "12:04");
  assert.equal(formatElapsed(59_999), "00:59");
  assert.equal(formatElapsed(3 * 3_600_000 + 61_000), "3:01:01");
  // A clock that went backwards, or was never set, must not reach the menu bar.
  assert.equal(formatElapsed(-5), "00:00");
  assert.equal(formatElapsed(NaN), "00:00");
  assert.equal(formatElapsed(Infinity), "00:00");
});
