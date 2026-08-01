import { test } from "node:test";
import assert from "node:assert/strict";
import { routeApp, scoreApps } from "../src/routing";
import { UNASSIGNED, type FleetApp } from "../src/fleet";

test("routes to the app whose vocabulary the text speaks", () => {
  assert.equal(
    routeApp("the prayer wall in the community feed needs a filter"),
    "togather",
  );
  assert.equal(
    routeApp("the run sheet should let me drag a volunteer between roles"),
    "events-os",
  );
  assert.equal(routeApp("bump the scaffold template in the monorepo"), "framework");
  assert.equal(routeApp("the fount studios release page"), "fount");
});

test("no vocabulary match is unassigned, not a guess", () => {
  assert.equal(routeApp("make the thing faster please"), UNASSIGNED);
  assert.equal(routeApp(""), UNASSIGNED);
});

test("an outright tie is unassigned", () => {
  const apps: FleetApp[] = [
    { key: "a", slug: "o/a", label: "A", vocabulary: ["alpha"] },
    { key: "b", slug: "o/b", label: "B", vocabulary: ["beta"] },
  ];
  assert.equal(routeApp("alpha and beta", apps), UNASSIGNED);
  assert.equal(routeApp("alpha only", apps), "a");
});

test("matching is case-insensitive and whole-word", () => {
  assert.equal(routeApp("PRAYER requests"), "togather");
  // "performance" contains "form" and "seated" contains "seat" — both are real
  // false positives the word boundaries exist to prevent.
  assert.equal(routeApp("performance of the seated layout"), UNASSIGNED);
});

test("multi-word vocabulary terms match as phrases", () => {
  const scored = scoreApps("update the org chart and the run sheet");
  const eventsOs = scored.find((entry) => entry.key === "events-os");
  assert.ok(eventsOs !== undefined);
  assert.deepEqual(eventsOs.matched.sort(), ["org chart", "run sheet"]);
});

test("distinct terms are counted, not occurrences", () => {
  const [top] = scoreApps("budget budget budget budget");
  assert.equal(top?.key, "events-os");
  assert.equal(top?.score, 1);
});

test("a sentence naming three concepts beats one repeated word", () => {
  assert.equal(
    routeApp("budget budget budget — the prayer, rsvp and announcement screens"),
    "togather",
  );
});
