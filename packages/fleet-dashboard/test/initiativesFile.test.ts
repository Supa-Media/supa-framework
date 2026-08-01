import assert from "node:assert/strict";
import { test } from "node:test";

import { indexInitiatives, parseInitiatives } from "../src/lib/initiativesFile";

test("the documented shape parses fully", () => {
  const manifest = parseInitiatives(
    JSON.stringify({
      initiatives: [
        { name: "giving", phase: "hardening", spec: "docs/plans/giving.md", archived: false },
        { name: "wa-parity", phase: "quiet", archived: true },
      ],
    }),
  );

  assert.deepEqual(manifest.problems, []);
  assert.deepEqual(manifest.entries[0], {
    name: "giving",
    phase: "hardening",
    spec: "docs/plans/giving.md",
    archived: false,
  });
  assert.equal(manifest.entries[1]?.archived, true);
  assert.equal(manifest.entries[1]?.spec, null);
});

test("a bare array is accepted — it is what people write first", () => {
  const manifest = parseInitiatives('[{"name":"giving"}]');
  assert.equal(manifest.entries[0]?.name, "giving");
  assert.deepEqual(manifest.problems, []);
});

test("an absent file is not an error", () => {
  for (const input of [null, undefined, "", "   "]) {
    const manifest = parseInitiatives(input);
    assert.deepEqual(manifest.entries, []);
    assert.deepEqual(manifest.problems, []);
  }
});

test("malformed JSON reports a problem instead of throwing", () => {
  const manifest = parseInitiatives('{"initiatives": [{"name": "giving",}]}');
  assert.deepEqual(manifest.entries, []);
  assert.equal(manifest.problems.length, 1);
  assert.match(manifest.problems[0] as string, /not valid JSON/);
});

test("the wrong top-level shape is reported, not guessed at", () => {
  const manifest = parseInitiatives('{"giving": "hardening"}');
  assert.deepEqual(manifest.entries, []);
  assert.match(manifest.problems[0] as string, /must be an array/);
});

test("readable entries survive alongside unreadable ones", () => {
  const manifest = parseInitiatives(
    JSON.stringify({ initiatives: [{ name: "giving" }, "nope", { phase: "quiet" }] }),
  );
  assert.deepEqual(
    manifest.entries.map((entry) => entry.name),
    ["giving"],
  );
  assert.equal(manifest.problems.length, 2);
});

test("an unknown phase is null and flagged, never coerced", () => {
  const manifest = parseInitiatives('[{"name":"a","phase":"shipping"}]');
  assert.equal(manifest.entries[0]?.phase, null);
  assert.match(manifest.problems[0] as string, /unknown phase/);
});

test("a phase is case-insensitive", () => {
  assert.equal(parseInitiatives('[{"name":"a","phase":"Hardening"}]').entries[0]?.phase, "hardening");
});

test("archived is strictly true, never truthy", () => {
  // `"archived": "no"` must not hide an initiative.
  assert.equal(parseInitiatives('[{"name":"a","archived":"no"}]').entries[0]?.archived, false);
  assert.equal(parseInitiatives('[{"name":"a","archived":1}]').entries[0]?.archived, false);
  assert.equal(parseInitiatives('[{"name":"a","archived":true}]').entries[0]?.archived, true);
});

test("a duplicate name keeps the first and says so", () => {
  const manifest = parseInitiatives(
    '[{"name":"a","phase":"idea"},{"name":"a","phase":"done"}]',
  );
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0]?.phase, "idea");
  assert.match(manifest.problems[0] as string, /more than once/);
});

test("indexing gives O(1) lookup by name", () => {
  const index = indexInitiatives(parseInitiatives('[{"name":"giving","phase":"launched"}]'));
  assert.equal(index.get("giving")?.phase, "launched");
  assert.equal(index.get("missing"), undefined);
});
