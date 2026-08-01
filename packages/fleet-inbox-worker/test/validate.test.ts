import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonBlock, parseExtraction } from "../src/validate";
import { UNASSIGNED } from "../src/fleet";

const wellFormed = {
  items: [
    {
      title: "  Let a leader pin a thread  ",
      acceptance_criteria: ["Pinned thread shows at the top", "  ", "Only leaders can pin"],
      app: "togather",
      initiative: "wa-parity",
      new_initiative: "",
      size: "m",
      source_quote: "leaders should be able to pin",
    },
  ],
  plan_edits: [
    {
      type: "cancel",
      target: "finance-v2-split",
      app: "events-os",
      reason: "superseded by the money page",
    },
  ],
};

test("accepts a well-formed response and normalizes whitespace", () => {
  const result = parseExtraction(wellFormed);
  assert.ok(result.ok);
  assert.equal(result.value.items.length, 1);
  const item = result.value.items[0]!;
  assert.equal(item.title, "Let a leader pin a thread");
  assert.deepEqual(item.acceptance_criteria, [
    "Pinned thread shows at the top",
    "Only leaders can pin",
  ]);
  assert.equal(item.is_new_initiative, false);
  assert.equal(result.value.plan_edits.length, 1);
  assert.deepEqual(result.warnings, []);
});

test("a proposed initiative sets is_new_initiative", () => {
  const result = parseExtraction({
    items: [{ title: "x", app: "togather", initiative: "", new_initiative: "inbox" }],
    plan_edits: [],
  });
  assert.ok(result.ok);
  assert.equal(result.value.items[0]?.initiative, "inbox");
  assert.equal(result.value.items[0]?.is_new_initiative, true);
});

test("both initiative fields set: the existing one wins", () => {
  const result = parseExtraction({
    items: [
      { title: "x", app: "togather", initiative: "wa-parity", new_initiative: "invented" },
    ],
    plan_edits: [],
  });
  assert.ok(result.ok);
  assert.equal(result.value.items[0]?.initiative, "wa-parity");
  assert.equal(result.value.items[0]?.is_new_initiative, false);
});

test("neither initiative field set falls back to misc", () => {
  const result = parseExtraction({ items: [{ title: "x", app: "togather" }], plan_edits: [] });
  assert.ok(result.ok);
  assert.equal(result.value.items[0]?.initiative, "misc");
});

test("an unknown app degrades to unassigned with a warning", () => {
  const result = parseExtraction({
    items: [{ title: "x", app: "some-other-repo", initiative: "y", size: "m" }],
    plan_edits: [],
  });
  assert.ok(result.ok);
  assert.equal(result.value.items[0]?.app, UNASSIGNED);
  assert.match(result.warnings.join(" "), /unknown app "some-other-repo"/);
});

test("an unknown size degrades to m with a warning", () => {
  const result = parseExtraction({
    items: [{ title: "x", app: "togather", size: "extra-large" }],
    plan_edits: [],
  });
  assert.ok(result.ok);
  assert.equal(result.value.items[0]?.size, "m");
  assert.match(result.warnings.join(" "), /unknown size/);
});

test("an item with no title is dropped, not defaulted", () => {
  const result = parseExtraction({
    items: [{ app: "togather" }, { title: "kept", app: "togather" }],
    plan_edits: [],
  });
  assert.ok(result.ok);
  assert.equal(result.value.items.length, 1);
  assert.equal(result.value.items[0]?.title, "kept");
  assert.match(result.warnings.join(" "), /missing title/);
});

test("a plan edit with an unknown type or no target is dropped", () => {
  const result = parseExtraction({
    items: [],
    plan_edits: [
      { type: "delete-everything", target: "x", app: "togather", reason: "" },
      { type: "modify", target: "", app: "togather", reason: "" },
      { type: "MODIFY", target: "kept", app: "togather", reason: "r" },
    ],
  });
  assert.ok(result.ok);
  assert.equal(result.value.plan_edits.length, 1);
  assert.equal(result.value.plan_edits[0]?.target, "kept");
  assert.equal(result.value.plan_edits[0]?.type, "modify");
});

test("empty arrays are a valid extraction, not a failure", () => {
  const result = parseExtraction({ items: [], plan_edits: [] });
  assert.ok(result.ok);
  assert.deepEqual(result.value, { items: [], plan_edits: [] });
});

test("plan_edits may be omitted entirely", () => {
  const result = parseExtraction({ items: [] });
  assert.ok(result.ok);
  assert.deepEqual(result.value.plan_edits, []);
});

test("structurally wrong documents fail hard", () => {
  for (const bad of [null, "a string", 42, [], { items: "not an array" }]) {
    const result = parseExtraction(bad);
    assert.equal(result.ok, false, `expected failure for ${JSON.stringify(bad)}`);
  }

  const badEdits = parseExtraction({ items: [], plan_edits: {} });
  assert.equal(badEdits.ok, false);
});

test("extractJsonBlock unwraps fenced and prose-wrapped JSON", () => {
  assert.equal(extractJsonBlock('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJsonBlock('Here you go:\n{"a":1}\nHope that helps.'), '{"a":1}');
  assert.equal(extractJsonBlock('  {"a":1}  '), '{"a":1}');
});

test("extractJsonBlock returns the input when there is no object to find", () => {
  // The caller's JSON.parse should raise the real syntax error, not one this
  // function invented by slicing.
  assert.equal(extractJsonBlock("  I refuse.  "), "I refuse.");
});
