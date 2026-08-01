import assert from "node:assert/strict";
import { test } from "node:test";

import { formatEngine, parseCaps, parseEngine, promptBody } from "../src/lib/engine";
import {
  buildAddLabelMutation,
  buildLabelQuery,
  buildMergedQuery,
} from "../src/sources/github/queries";

/**
 * A trimmed copy of a real gardener source (togather's `gardener-large-files.md`).
 * The shape matters: `engine:` is a mapping with an `env:` block, and `model:`
 * sits at the TOP level rather than inside it.
 */
const REAL_GARDENER = `---
name: "Gardener: Large Files"

max-ai-credits: 200        # ~$2.00 per run
max-daily-ai-credits: 250
max-turns: 30
max-turn-cache-misses: 40

engine:
  id: codex
  env:
    OPENAI_BASE_URL: "https://ollama.com/v1"
    OPENAI_API_KEY: "\${{ secrets.OLLAMA_API_KEY }}"
model: deepseek-v4-flash

models:
  default-ai-credits-pricing:
    input: 0.14
---

# Gardener: Large File Refactor Scout

You are a code-health scout.
`;

test("a top-level model is found even when the engine is a mapping", () => {
  // Every real gardener in the fleet writes it this way; v1 only looked inside
  // the mapping, so the column that exists to make an expensive model obvious
  // showed just "codex" for all of them.
  const engine = parseEngine(REAL_GARDENER);
  assert.deepEqual(engine, { id: "codex", model: "deepseek-v4-flash" });
  assert.equal(formatEngine(engine), "codex · deepseek-v4-flash");
});

test("`models:` is not mistaken for `model:`", () => {
  const engine = parseEngine("---\nmodels:\n  pricing:\n    input: 1\nengine: claude\n---\n");
  assert.equal(engine.model, null);
});

test("a nested model wins over a top-level one", () => {
  const engine = parseEngine("---\nmodel: outer\nengine:\n  id: custom\n  model: inner\n---\n");
  assert.equal(engine.model, "inner");
});

test("a scalar engine still picks up the top-level model", () => {
  assert.deepEqual(parseEngine("---\nengine: claude\nmodel: opus\n---\n"), {
    id: "claude",
    model: "opus",
  });
});

test("caps convert AI credits to dollars at 1 credit = $0.01", () => {
  assert.deepEqual(parseCaps(REAL_GARDENER), {
    perRunUsd: 2,
    perDayUsd: 2.5,
    maxTurns: 30,
  });
});

test("`max-turn-cache-misses` is not read as `max-turns`", () => {
  const caps = parseCaps("---\nmax-turn-cache-misses: 40\n---\n");
  assert.equal(caps.maxTurns, null);
});

test("undeclared caps are null, never zero", () => {
  // "$0.00 per run" would read as a hard-capped gardener; it means "unstated".
  assert.deepEqual(parseCaps("---\nengine: claude\n---\n"), {
    perRunUsd: null,
    perDayUsd: null,
    maxTurns: null,
  });
  assert.deepEqual(parseCaps("no frontmatter at all"), {
    perRunUsd: null,
    perDayUsd: null,
    maxTurns: null,
  });
});

test("a non-numeric cap is ignored rather than rendered as NaN", () => {
  assert.equal(parseCaps("---\nmax-ai-credits: lots\n---\n").perRunUsd, null);
  assert.equal(parseCaps("---\nmax-turns: -1\n---\n").maxTurns, null);
});

test("the prompt is everything below the frontmatter, verbatim", () => {
  const prompt = promptBody(REAL_GARDENER);
  assert.ok(prompt.startsWith("# Gardener: Large File Refactor Scout"));
  assert.ok(prompt.endsWith("You are a code-health scout."));
  assert.ok(!prompt.includes("max-ai-credits"), "frontmatter must not leak into the prompt");
});

test("a document with no frontmatter is all prompt", () => {
  assert.equal(promptBody("just instructions\n"), "just instructions");
  assert.equal(promptBody(""), "");
});

/* ── Queries added in v2 ────────────────────────────────────────────────── */

test("label search quotes every label name", () => {
  const query = buildLabelQuery(["o/a"]);
  // Unquoted, `label:agent:ready` parses as the qualifier `label` with value
  // `agent` — it matches nothing and the queue would sit empty forever.
  assert.ok(query.includes('label:"agent:ready","agent:in-progress"'));
  assert.ok(query.includes("is:issue"));
  assert.ok(query.includes("is:open"));
  assert.ok(query.includes("repo:o/a"));
});

test("the merged search uses a full instant, not a date", () => {
  const query = buildMergedQuery("o/a", "2026-08-01T06:00:00.000Z");
  assert.ok(query.includes("merged:>=2026-08-01T06:00:00.000Z"));
  assert.ok(query.includes("is:merged"));
  // A day-granular filter would re-show the morning's merges at the evening
  // review, since the two are twelve hours apart on the same day.
  assert.ok(query.includes("T06:00:00"));
});

test("the approve mutation carries one aliased field per issue and one label", () => {
  const mutation = buildAddLabelMutation(3);
  for (const i of [0, 1, 2]) {
    assert.ok(mutation.includes(`add${i}: addLabelsToLabelable`));
    assert.ok(mutation.includes(`$target${i}: ID!`));
  }
  assert.ok(!mutation.includes("add3:"));
  assert.equal(mutation.match(/\$labelId: ID!/g)?.length, 1);
});
