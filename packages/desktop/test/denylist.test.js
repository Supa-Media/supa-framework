/**
 * The denylist is the promise that makes a watching app acceptable, so its
 * matcher is checked from both directions: everything a person would plausibly
 * mean by one word must match, and nothing they did not mean may.
 *
 * The second direction is the one that has no other alarm. A false positive —
 * `zoom` quietly denying `Zoombini` — presents as "the app just stopped working
 * for that one thing", with nothing on screen to explain it, because a denied
 * subject leaves no trace on purpose.
 *
 * ## Sabotage record
 *
 *   segment equality replaced with `includes()` (substring matching)     1 failure
 *   `withoutDenied` returning the input unchanged                        2 failures
 *   the empty-entry filter removed from `entrySet`                       0 failures
 *
 * That last line is recorded rather than fixed. The filter is unreachable
 * defence: `nameSegments` and `hostSegments` both drop empty segments, so an
 * empty denylist entry has nothing to match even if it survives into the set.
 * It is kept because it is the guard that would matter the moment either of
 * those two functions is loosened, and it is written down here as untested
 * rather than left looking covered.
 *
 * The substring sabotage failing only once is the honest count for a rule whose
 * violations all land in one case — but that case names three apps, so the
 * message tells you which shape of over-matching came back.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { isDenied, isDeniedApp, isDeniedUrl, normalizeAppName, withoutDenied } from "../src/index.js";

test("one typed word matches every shape the same app arrives under", () => {
  const list = ["zoom"];
  for (const candidate of ["Zoom", "zoom.us", "us.zoom.xos", "/Applications/zoom.us.app", "ZOOM"]) {
    assert.equal(isDeniedApp(candidate, list), true, candidate);
  }
});

test("it is segment equality, never a substring", () => {
  assert.equal(isDeniedApp("Zoombini", ["zoom"]), false);
  assert.equal(isDeniedApp("Meetup", ["meet"]), false);
  assert.equal(isDeniedApp("Slackline", ["slack"]), false);
  // ...and the genuine ones still match, so the rule is narrow rather than off.
  assert.equal(isDeniedApp("Slack", ["slack"]), true);
});

test("a host matches by label, by suffix, and in full — but never by its TLD", () => {
  assert.equal(isDeniedUrl("https://teams.microsoft.com/l/meeting", ["teams"]), true);
  assert.equal(isDeniedUrl("https://teams.microsoft.com/l/meeting", ["microsoft.com"]), true);
  assert.equal(isDeniedUrl("https://teams.microsoft.com/l/meeting", ["teams.microsoft.com"]), true);
  assert.equal(isDeniedUrl("https://teams.microsoft.com/l/meeting", ["com"]), false, "`com` must not deny the internet");
  assert.equal(isDeniedUrl("https://example.test/call", ["teams"]), false);
});

test("an empty list denies nothing, and an empty entry denies nothing", () => {
  assert.equal(isDeniedApp("Zoom", []), false);
  assert.equal(isDeniedApp("Zoom", ["", "   "]), false);
  // The failure this guards: a normalised empty entry matching every candidate
  // whose normalised name is also empty — "denies everything", undiagnosable.
  assert.equal(isDeniedApp("", ["", "zoom"]), false);
  assert.equal(isDenied({ app: undefined, url: undefined }, ["zoom"]), false);
});

test("a subject is denied by its name or by its address", () => {
  assert.equal(isDenied({ app: "Safari", url: "https://zoom.us/j/123" }, ["zoom"]), true);
  assert.equal(isDenied({ app: "zoom.us", url: null }, ["zoom"]), true);
  assert.equal(isDenied({ app: "Safari", url: "https://example.test" }, ["zoom"]), false);
  assert.equal(isDenied({ app: "Safari", url: "not a url" }, ["zoom"]), false, "a junk URL is not a match");
});

test("a denied thing is absent from the list, not marked in it", () => {
  const windows = [
    { app: "zoom.us", title: "Weekly sync" },
    { app: "Safari", title: "Docs", url: "https://example.test/doc" },
    { app: "Safari", title: "Therapy portal", url: "https://calm.example/session" },
  ];
  const visible = withoutDenied(windows, ["zoom", "calm.example"], (w) => ({ app: w.app, url: w.url }));
  assert.deepEqual(
    visible.map((w) => w.title),
    ["Docs"],
  );
  // The point of filtering rather than redacting: no placeholder survives, so a
  // denied window's title cannot reach a tooltip, a log or a crash report.
  assert.equal(JSON.stringify(visible).includes("Weekly sync"), false);
  assert.equal(JSON.stringify(visible).includes("Therapy"), false);
});

test("withoutDenied accepts a plain string describer and copies rather than aliases", () => {
  const processes = ["zoom.us", "Safari", "Music"];
  assert.deepEqual(withoutDenied(processes, ["zoom"]), ["Safari", "Music"]);
  const unchanged = withoutDenied(processes, []);
  assert.deepEqual(unchanged, processes);
  assert.notEqual(unchanged, processes, "an empty denylist still returns a copy, so a caller cannot mutate the source");
});

test("normalizeAppName reduces a path or bundle id to the token a person types", () => {
  assert.equal(normalizeAppName("/Applications/zoom.us.app"), "zoom.us");
  assert.equal(normalizeAppName("  Zoom  "), "zoom");
  assert.equal(normalizeAppName(""), "");
  assert.equal(normalizeAppName(undefined), "");
});
