import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMatrix, missingRequired, parseAllowlist, tierOf } from "../src/lib/allowlist";

// The three real shapes in the fleet, trimmed. togather uses `$comment` and
// both tiers; events-os uses `_comment` and required only; fount has no comment.
const TOGATHER = JSON.stringify({
  $comment: "1Password -> GitHub …",
  required: ["CONVEX_DEPLOY_KEY", "STRIPE_SECRET_KEY"],
  optional: ["EXPO_PUBLIC_MAPBOX_TOKEN"],
});
const EVENTS_OS = JSON.stringify({
  _comment: "…",
  required: ["CLOUDFLARE_API_TOKEN", "CONVEX_DEPLOY_KEY"],
});
const FOUNT = JSON.stringify({
  required: ["CONVEX_DEPLOY_KEY"],
  optional: ["STRIPE_SECRET_KEY"],
});

test("all three real allowlist shapes parse", () => {
  assert.deepEqual(parseAllowlist(TOGATHER).optional, ["EXPO_PUBLIC_MAPBOX_TOKEN"]);
  assert.deepEqual(parseAllowlist(EVENTS_OS).optional, []);
  assert.equal(parseAllowlist(EVENTS_OS).problem, null);
  assert.deepEqual(parseAllowlist(FOUNT).required, ["CONVEX_DEPLOY_KEY"]);
});

test("an unreadable or empty allowlist reports rather than throws", () => {
  assert.match(parseAllowlist("{oops").problem as string, /not valid JSON/);
  assert.match(parseAllowlist("[]").problem as string, /expected a JSON object/);
  assert.match(parseAllowlist("{}").problem as string, /no `required` or `optional`/);
  assert.equal(parseAllowlist(null).problem, null);
  assert.deepEqual(parseAllowlist(null).required, []);
});

test("non-string entries are dropped, not rendered as rows", () => {
  const allowlist = parseAllowlist('{"required":["A",null,42,"  ","B"]}');
  assert.deepEqual(allowlist.required, ["A", "B"]);
});

test("tiers are exact", () => {
  const allowlist = parseAllowlist(TOGATHER);
  assert.equal(tierOf(allowlist, "CONVEX_DEPLOY_KEY"), "required");
  assert.equal(tierOf(allowlist, "EXPO_PUBLIC_MAPBOX_TOKEN"), "optional");
  assert.equal(tierOf(allowlist, "NOPE"), null);
});

test("the matrix is the union of every repo's keys, sorted", () => {
  const rows = buildMatrix([
    { repoKey: "a/togather", allowlist: parseAllowlist(TOGATHER), secretNames: [] },
    { repoKey: "b/events-os", allowlist: parseAllowlist(EVENTS_OS), secretNames: [] },
    { repoKey: "c/fount", allowlist: parseAllowlist(FOUNT), secretNames: [] },
  ]);

  assert.deepEqual(
    rows.map((row) => row.key),
    [
      "CLOUDFLARE_API_TOKEN",
      "CONVEX_DEPLOY_KEY",
      "EXPO_PUBLIC_MAPBOX_TOKEN",
      "STRIPE_SECRET_KEY",
    ],
  );

  // A key one repo requires and another does not list at all is the whole
  // reason the matrix unions rather than intersects.
  const cloudflare = rows[0];
  assert.equal(cloudflare?.cells[0]?.tier, null);
  assert.equal(cloudflare?.cells[1]?.tier, "required");
  assert.equal(cloudflare?.cells[2]?.tier, null);

  // The same key can sit in different tiers per repo.
  const stripe = rows[3];
  assert.equal(stripe?.cells[0]?.tier, "required");
  assert.equal(stripe?.cells[2]?.tier, "optional");
});

test("an unreadable secret list is unknown, not missing", () => {
  const rows = buildMatrix([
    { repoKey: "a/x", allowlist: parseAllowlist(FOUNT), secretNames: null },
  ]);
  assert.equal(rows[0]?.cells[0]?.secretExists, null);
  // And it must not raise a false alarm.
  assert.deepEqual(missingRequired(rows), []);
});

test("a repo that does not list a key has no opinion about its secret", () => {
  const rows = buildMatrix([
    { repoKey: "a/x", allowlist: parseAllowlist(EVENTS_OS), secretNames: [] },
    { repoKey: "b/y", allowlist: parseAllowlist(TOGATHER), secretNames: [] },
  ]);
  const mapbox = rows.find((row) => row.key === "EXPO_PUBLIC_MAPBOX_TOKEN");
  assert.equal(mapbox?.cells[0]?.tier, null);
  assert.equal(mapbox?.cells[0]?.secretExists, null);
});

test("missingRequired finds only required keys with a confirmed absent secret", () => {
  const rows = buildMatrix([
    {
      repoKey: "a/x",
      allowlist: parseAllowlist(TOGATHER),
      secretNames: ["CONVEX_DEPLOY_KEY"],
    },
  ]);

  assert.deepEqual(
    missingRequired(rows).map((row) => row.key),
    ["STRIPE_SECRET_KEY"],
  );
  // The optional one is absent too, and deliberately does not raise the alarm.
  const mapbox = rows.find((row) => row.key === "EXPO_PUBLIC_MAPBOX_TOKEN");
  assert.equal(mapbox?.cells[0]?.secretExists, false);
});

test("an empty fleet produces an empty matrix", () => {
  assert.deepEqual(buildMatrix([]), []);
});
