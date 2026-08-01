import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deciderConfidence,
  findMarker,
  optionLabel,
  parseMarkers,
  questionOptions,
} from "../src/lib/markers";

const DECIDER = `**[decider]** Fount size buckets → matched Togather's (1–50/51–200/200+)
reasoning: cross-app consistency, migration-free
confidence: high

Nothing else in the fleet uses a different scale.`;

test("a decider comment yields a headline, fields, and body", () => {
  const [block] = parseMarkers(DECIDER);
  assert.equal(block?.marker, "decider");
  assert.equal(block?.headline, "Fount size buckets → matched Togather's (1–50/51–200/200+)");
  assert.equal(block?.fields["reasoning"], "cross-app consistency, migration-free");
  assert.equal(deciderConfidence(block!), "high");
  assert.equal(block?.body, "Nothing else in the fleet uses a different scale.");
});

test("an unrecognized confidence reads as unstated, never as high", () => {
  const [block] = parseMarkers("**[decider]** x\nconfidence: pretty sure");
  assert.equal(deciderConfidence(block!), null);
  assert.equal(deciderConfidence(parseMarkers("**[decider]** x")[0]!), null);
});

test("a context sheet and the question inside it are separate blocks", () => {
  const sheet = `**[context-sheet]**
tried: four shapes of auth header against the sandbox key
failed: 403 every time, identical body
remaining: mint a production-scoped key — human-only

**[question]** Offline retry: dedupe by client id or server timestamp?
options: client id | server timestamp | both, prefer client`;

  const blocks = parseMarkers(sheet);
  assert.deepEqual(
    blocks.map((block) => block.marker),
    ["context-sheet", "question"],
  );

  const context = findMarker(sheet, "context-sheet");
  assert.equal(context?.fields["failed"], "403 every time, identical body");
  // The question's fields must not leak into the sheet's.
  assert.equal(context?.fields["options"], undefined);

  const question = findMarker(sheet, "question");
  assert.deepEqual(questionOptions(question!), [
    "client id",
    "server timestamp",
    "both, prefer client",
  ]);
});

test("a marker quoted mid-sentence does not file itself as a decision", () => {
  // Otherwise a review comment explaining the convention would appear on the
  // review screen as a decision to keep or overturn.
  assert.deepEqual(parseMarkers("we should use **[decider]** for this"), []);
});

test("a marker must open the line, but may be indented", () => {
  assert.equal(parseMarkers("  **[question]** why?")[0]?.marker, "question");
});

test("a repeated field keeps the first value", () => {
  const [block] = parseMarkers("**[decider]** x\nconfidence: high\nconfidence: low");
  assert.equal(block?.fields["confidence"], "high");
});

test("a URL in the body is not mistaken for a field", () => {
  const [block] = parseMarkers("**[context-sheet]**\nsee https://example.com/a for the run");
  assert.deepEqual(block?.fields, {});
  assert.equal(block?.body, "see https://example.com/a for the run");
});

test("options are capped and blanks dropped", () => {
  const [block] = parseMarkers("**[question]** q\noptions: a | b || c | d | e | f | g");
  assert.deepEqual(questionOptions(block!), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(questionOptions(parseMarkers("**[question]** q")[0]!), []);
});

test("marker names are lowercased and CRLF is tolerated", () => {
  const [block] = parseMarkers("**[Context-Sheet]**\r\ntried: x\r\n");
  assert.equal(block?.marker, "context-sheet");
  assert.equal(block?.fields["tried"], "x");
});

test("a marker inside a fenced code block is quoted, not filed", () => {
  // A fence is how someone actually quotes the convention in a GitHub comment,
  // so the start-of-line rule alone left the common case open.
  const body = [
    "**[question]** real?",
    "options: a | b",
    "",
    "```",
    "**[decider]** fake",
    "options: x | y",
    "```",
  ].join("\n");

  const blocks = parseMarkers(body);
  assert.deepEqual(
    blocks.map((block) => block.marker),
    ["question"],
  );
  // The fenced `options:` is sample text, not answer buttons.
  assert.deepEqual(questionOptions(blocks[0]!), ["a", "b"]);
  assert.ok(blocks[0]?.body.includes("**[decider]** fake"));
});

test("a fence closes only on its own character, and tildes work too", () => {
  const backticks = ["**[decider]** kept", "```md", "~~~", "**[question]** fake", "```"].join("\n");
  assert.deepEqual(
    parseMarkers(backticks).map((block) => block.marker),
    ["decider"],
  );

  const tildes = ["~~~", "**[decider]** fake", "~~~", "**[question]** real"].join("\n");
  assert.deepEqual(
    parseMarkers(tildes).map((block) => block.marker),
    ["question"],
  );
});

test("duplicate options collapse, because the UI keys buttons by value", () => {
  const [block] = parseMarkers("**[question]** q\noptions: a | a | b");
  assert.deepEqual(questionOptions(block!), ["a", "b"]);
});

test("a long option is clamped for the button but never for the answer", () => {
  const long = "x".repeat(200);
  const [block] = parseMarkers(`**[question]** q\noptions: ${long}`);
  const [option] = questionOptions(block!);
  assert.equal(option, long, "the value posted as the answer stays verbatim");
  assert.equal(optionLabel(option!).length, 72);
  assert.ok(optionLabel(option!).endsWith("…"));
  assert.equal(optionLabel("short"), "short");
});

test("empty input and no markers yield nothing", () => {
  assert.deepEqual(parseMarkers(""), []);
  assert.deepEqual(parseMarkers(null), []);
  assert.deepEqual(parseMarkers("a normal comment"), []);
  assert.equal(findMarker("a normal comment", "decider"), null);
});
