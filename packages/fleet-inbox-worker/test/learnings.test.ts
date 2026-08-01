import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendLearning,
  formatRejectionLearning,
  readLearnings,
  trimLearnings,
  LEARNINGS_KEY,
  MAX_LEARNING_LINES,
  type LearningsStore,
} from "../src/learnings";

function fakeStore(initial?: string): LearningsStore & { value: string | null } {
  return {
    value: initial ?? null,
    async get() {
      return this.value;
    },
    async put(_key: string, value: string) {
      this.value = value;
    },
  };
}

test("appending keeps order and drops the oldest past the cap", () => {
  let file = "";
  for (let i = 1; i <= MAX_LEARNING_LINES + 5; i += 1) {
    file = trimLearnings(file, `- line ${i}`);
  }

  const lines = file.split("\n");
  assert.equal(lines.length, MAX_LEARNING_LINES);
  assert.equal(lines[0], "- line 6", "the five oldest were evicted");
  assert.equal(lines.at(-1), `- line ${MAX_LEARNING_LINES + 5}`);
});

test("blank lines are not stored", () => {
  const file = trimLearnings("- a\n\n\n- b", "   ");
  assert.equal(file, "- a\n- b");
});

test("an identical rejection is not re-appended", () => {
  // Re-adding a duplicate would evict a distinct lesson for no new signal.
  const once = trimLearnings("", "- x");
  assert.equal(trimLearnings(once, "- x"), "- x");
});

test("the cap is honoured even when the stored file is already over it", () => {
  const oversized = Array.from({ length: 50 }, (_, i) => `- old ${i}`).join("\n");
  const lines = trimLearnings(oversized, "- new").split("\n");
  assert.equal(lines.length, MAX_LEARNING_LINES);
  assert.equal(lines.at(-1), "- new");
});

test("a rejection line names the app and the title", () => {
  const line = formatRejectionLearning("  Add   a   dark mode  ", "togather");
  assert.equal(
    line,
    '- Rejected (Togather): "Add a dark mode" — do not propose work like this again.',
  );
});

test("an unrouted rejection still produces a usable line", () => {
  assert.match(formatRejectionLearning("x", "unassigned"), /Rejected \(Unassigned\)/);
});

test("reading an empty store yields an empty string, not null", async () => {
  assert.equal(await readLearnings(fakeStore()), "");
});

test("appendLearning round-trips through the store", async () => {
  const store = fakeStore();
  await appendLearning(store, "- first");
  await appendLearning(store, "- second");
  assert.equal(store.value, "- first\n- second");
  assert.equal(await readLearnings(store), "- first\n- second");
});

test("learnings live under a stable key", () => {
  assert.equal(LEARNINGS_KEY, "learnings.md");
});
