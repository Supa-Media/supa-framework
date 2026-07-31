import assert from "node:assert/strict";
import { test } from "node:test";

import { formatEngine, frontmatter, parseEngine } from "../src/lib/engine";

const SCALAR_FORM = [
  "---",
  'private: true',
  "on:",
  "  schedule:",
  '    - cron: "0 9 * * 1"',
  "engine: claude",
  "imports:",
  "  - shared/reporting.md",
  "---",
  "",
  "# Triage gardener",
].join("\n");

const MAPPING_FORM = [
  "---",
  'emoji: "🌱"',
  "engine:",
  "  id: custom",
  "  model: qwen3-coder:480b",
  "  max-turns: 12",
  "strict: true",
  "---",
  "",
  "Body text.",
].join("\n");

test("the scalar form yields an engine id and no model", () => {
  assert.deepEqual(parseEngine(SCALAR_FORM), { id: "claude", model: null });
  assert.equal(formatEngine(parseEngine(SCALAR_FORM)), "claude");
});

test("the mapping form yields both id and model", () => {
  assert.deepEqual(parseEngine(MAPPING_FORM), { id: "custom", model: "qwen3-coder:480b" });
  assert.equal(formatEngine(parseEngine(MAPPING_FORM)), "custom · qwen3-coder:480b");
});

test("a mapping without a model still reports its id", () => {
  const source = ["---", "engine:", "  id: copilot", "  agent: adr-writer", "---"].join("\n");
  assert.deepEqual(parseEngine(source), { id: "copilot", model: null });
  assert.equal(formatEngine(parseEngine(source)), "copilot");
});

test("quotes and trailing comments are stripped", () => {
  const source = ['---', 'engine: "codex"  # cheaper', "---"].join("\n");
  assert.deepEqual(parseEngine(source), { id: "codex", model: null });
});

test("a missing engine renders as an em dash, never a guess", () => {
  assert.deepEqual(parseEngine(["---", "on: daily", "---"].join("\n")), {
    id: null,
    model: null,
  });
  assert.equal(formatEngine({ id: null, model: null }), "—");
  // No frontmatter at all.
  assert.equal(frontmatter("# Just a readme"), null);
  assert.deepEqual(parseEngine("# Just a readme"), { id: null, model: null });
});

test("only the frontmatter is scanned, so the prose body can't spoof the engine", () => {
  const source = [
    "---",
    "on: daily",
    "---",
    "",
    "Configure it like this:",
    "",
    "```yaml",
    "engine: claude",
    "```",
  ].join("\n");
  assert.deepEqual(parseEngine(source), { id: null, model: null });
});

test("an engine block ends at the next top-level key", () => {
  const source = [
    "---",
    "engine:",
    "  id: pi",
    "tools:",
    "  model: not-the-engines-model",
    "---",
  ].join("\n");
  assert.deepEqual(parseEngine(source), { id: "pi", model: null });
});
