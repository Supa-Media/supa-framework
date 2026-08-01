import assert from "node:assert/strict";
import { test } from "node:test";

import { evidenceSection, parseEvidence } from "../src/lib/evidence";

const BODY = `Fixes the thing.

## Evidence

- ![thread view](https://user-images.githubusercontent.com/1/a.png)
- ![after](https://user-images.githubusercontent.com/1/b.png)
- tests: 41 passing, 2 new
- [staging deploy](https://github.com/o/r/actions/runs/9)
- manual: replied to a hidden thread on device

## Notes

Not evidence.
`;

test("evidence comes from the ## Evidence section only", () => {
  const evidence = parseEvidence(BODY);
  assert.equal(evidence.items.length, 5);
  assert.equal(evidence.screenshotCount, 2);
  assert.ok(!evidence.items.some((item) => item.label.includes("Not evidence")));
});

test("each bullet is classified and keeps its link", () => {
  const evidence = parseEvidence(BODY);
  const [first, , tests, staging, manual] = evidence.items;

  assert.equal(first?.kind, "screenshot");
  assert.equal(first?.label, "thread view");
  assert.equal(first?.url, "https://user-images.githubusercontent.com/1/a.png");

  assert.equal(tests?.kind, "test");
  assert.equal(tests?.label, "tests: 41 passing, 2 new");
  assert.equal(tests?.url, null);

  assert.equal(staging?.kind, "link");
  assert.equal(staging?.url, "https://github.com/o/r/actions/runs/9");

  assert.equal(manual?.kind, "note");
});

test("the section ends at the next heading of the same or higher level", () => {
  const section = evidenceSection("### Evidence\n- a\n## Later\n- b\n");
  assert.equal(section?.includes("- a"), true);
  assert.equal(section?.includes("- b"), false);
});

test("a deeper heading inside the section is still evidence", () => {
  const evidence = parseEvidence("## Evidence\n- a\n### Screenshots\n- b\n## Done\n- c\n");
  assert.deepEqual(
    evidence.items.map((item) => item.label),
    ["a", "b"],
  );
});

test("a commented-out template section is not evidence", () => {
  // A PR template that ships the heading commented out would otherwise make
  // every PR opened from it show its own instructions as proof.
  const evidence = parseEvidence("<!--\n## Evidence\n- add screenshots here\n-->\nreal body");
  assert.deepEqual(evidence.items, []);
  assert.equal(evidence.screenshotCount, 0);
});

test("no section, empty section, and a null body all yield nothing", () => {
  assert.deepEqual(parseEvidence("just a description").items, []);
  assert.deepEqual(parseEvidence("## Evidence\n\nprose, no bullets\n").items, []);
  assert.deepEqual(parseEvidence(null).items, []);
  assert.deepEqual(parseEvidence(undefined).items, []);
  assert.deepEqual(parseEvidence("").items, []);
});

test("numbered items count, and inline markdown is stripped for the chip", () => {
  const evidence = parseEvidence("## Evidence\n1. **typecheck** and `pnpm test` green\n");
  assert.equal(evidence.items[0]?.label, "typecheck and pnpm test green");
  assert.equal(evidence.items[0]?.kind, "test");
});

test("a bare https URL in a bullet is still clickable; http is not", () => {
  const secure = parseEvidence("## Evidence\n- deployed https://example.com/run/1\n");
  assert.equal(secure.items[0]?.url, "https://example.com/run/1");

  const insecure = parseEvidence("## Evidence\n- deployed http://example.com/run/1\n");
  assert.equal(insecure.items[0]?.url, null);
});

test("CRLF bodies parse the same as LF ones", () => {
  const evidence = parseEvidence("## Evidence\r\n- tests green\r\n## Notes\r\n- no\r\n");
  assert.deepEqual(
    evidence.items.map((item) => item.label),
    ["tests green"],
  );
});

test("the heading match is case-insensitive but must be a heading", () => {
  assert.notEqual(evidenceSection("## evidence\n- a\n"), null);
  // Prose mentioning the word is not a section.
  assert.equal(evidenceSection("the evidence is below\n- a\n"), null);
});
