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

/** The line recorded when a proposal is rejected. */
export function formatRejectionLearning(title: string, appKey: string): string {
  return `- Rejected (${labelForApp(appKey)}): "${title.replace(/\s+/g, " ").trim()}" — do not propose work like this again.`;
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
