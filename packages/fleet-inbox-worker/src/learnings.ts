/**
 * What the extractor learns from being told "no".
 *
 * Every ❌ appends a line to a `learnings.md` in KV, and every later extraction
 * prompt gets that file injected. It's the cheapest possible feedback loop: no
 * fine-tuning, no eval harness, just a running list of "you proposed this and
 * it was rejected" that the model reads before proposing again.
 *
 * The list is capped and FIFO. Thirty lines is roughly a paragraph of prompt —
 * small enough to inject on every call without thinking about cost, large
 * enough to carry real signal. Unbounded growth would eventually make every
 * extraction more expensive than the work it's extracting.
 */

import { labelForApp } from "./fleet";

/** KV key holding the learnings file. */
export const LEARNINGS_KEY = "learnings.md";

/** How many learning lines are kept. Oldest are dropped first. */
export const MAX_LEARNING_LINES = 30;

/** The subset of KV this module needs — a plain object in tests. */
export interface LearningsStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/**
 * Append a line and trim to the newest `max`.
 *
 * Pure, so the FIFO behavior is testable without KV. Blank lines are dropped so
 * a file that accumulated stray newlines doesn't spend its budget on nothing,
 * and an exact duplicate is not re-appended — the same rejection twice is one
 * lesson, and re-adding it would evict a distinct one.
 */
export function trimLearnings(
  existing: string,
  line: string,
  max = MAX_LEARNING_LINES,
): string {
  const lines = existing
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  const trimmedLine = line.trim();
  if (trimmedLine !== "" && !lines.includes(trimmedLine)) lines.push(trimmedLine);

  return lines.slice(-max).join("\n");
}

/**
 * How much of a rejected title survives into the learning line.
 *
 * Deliberately independent of `clampTitle`'s 200-char issue-title cap: this is
 * a prompt-budget bound, and it should not change silently because a GitHub
 * concern changed.
 */
export const MAX_LEARNING_TITLE_CHARS = 120;

/**
 * The line recorded when a proposal is rejected.
 *
 * This string is interpolated verbatim into the `## Previously rejected`
 * section of every later extraction system prompt, so it is a real injection
 * surface: a transcript shapes a title, ❌ files it, and it sits in the next 30
 * prompts. The sanitisation is deliberate, not incidental —
 *
 *  - **Whitespace is collapsed.** The load-bearing part: it flattens newlines,
 *    so a title cannot forge extra learning lines or a fake `##` section header
 *    inside the prompt.
 *  - **Backticks and quotes are stripped**, so the span cannot close the
 *    quoting that surrounds it here.
 *  - **Length is capped explicitly** (above); FIFO caps the total budget.
 *
 * Note `title` is read back from GitHub rather than taken from the model, so
 * anyone with write access to any of the four repos could rename an issue to
 * choose this string. Narrow, but it is a second author — and the same three
 * bounds are what contain it.
 */
export function formatRejectionLearning(title: string, appKey: string): string {
  const sanitised = title
    .replace(/[`"'“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LEARNING_TITLE_CHARS);
  return `- Rejected (${labelForApp(appKey)}): "${sanitised}" — do not propose work like this again.`;
}

export async function readLearnings(store: LearningsStore): Promise<string> {
  return (await store.get(LEARNINGS_KEY)) ?? "";
}

export async function appendLearning(
  store: LearningsStore,
  line: string,
): Promise<void> {
  const existing = await readLearnings(store);
  await store.put(LEARNINGS_KEY, trimLearnings(existing, line));
}
