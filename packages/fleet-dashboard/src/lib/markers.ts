/**
 * Marker comments — how an agent talks to the morning review.
 *
 * Agents cannot call the dashboard; there is no backend to call. They write
 * GitHub comments, and a comment earns a place on the review screen by opening
 * with a **marker**: a bolded bracketed word on its own, at the very start of
 * the comment.
 *
 *     **[decider]** Fount size buckets → matched Togather's (1–50/51–200/200+)
 *     reasoning: cross-app consistency, migration-free
 *     confidence: high
 *
 *     **[context-sheet]**
 *     tried: re-ran the export against the sandbox key, 4 shapes of auth header
 *     failed: 403 on every attempt, same body
 *     remaining: mint a production-scoped Increase key — human-only
 *
 *     **[question]** Offline retry: dedupe by client id or server timestamp?
 *     options: client id | server timestamp
 *
 * Three markers, three panels:
 *
 *   `decider`        → "Decisions made in your absence" (Keep / Overturn)
 *   `context-sheet`  → "Parked — needs you", rendered inline under the issue
 *   `question`       → "Questions batched", with the `options:` as buttons
 *
 * A `question` marker may appear on its own or inside a context sheet — the
 * watchdog writes one sheet per park and the question is part of it, so this
 * parser returns every marker block in a document rather than only the first.
 *
 * Deliberately strict about placement: the marker must start a line. Otherwise
 * a review comment *quoting* the convention ("we should use **[decider]** for
 * this") would file itself as a decision you have to keep or overturn.
 */

export interface MarkerBlock {
  /** Lowercased marker name: `decider`, `context-sheet`, `question`. */
  marker: string;
  /** The rest of the marker's own line. Empty when the marker stood alone. */
  headline: string;
  /**
   * `key: value` lines within the block, keys lowercased. A repeated key keeps
   * the first occurrence — an agent restating `confidence:` twice is a bug in
   * the agent, and picking the later one would silently prefer the bug.
   */
  fields: Record<string, string>;
  /** Everything in the block that was neither the marker line nor a field. */
  body: string;
}

/** `**[name]**` at the start of a line. */
const MARKER_LINE = /^\s*\*\*\[([a-z][a-z0-9-]*)\]\*\*\s*(.*)$/i;
/**
 * A lowercase `key: value` line.
 *
 * One word — no spaces — which is the rule that keeps prose out of the field
 * map. `see https://example.com/a for the run` is a sentence, and a key pattern
 * permitting spaces reads it as the field `see https` with the value
 * `//example.com/a …`, quietly deleting the line from the body it belongs to.
 */
const FIELD_LINE = /^\s*([a-z][a-z0-9_-]{0,30}):\s*(.+?)\s*$/;

/**
 * Every marker block in a comment body, in document order.
 *
 * Never throws — a malformed comment yields no blocks, and the panel that
 * wanted one shows its empty state.
 */
export function parseMarkers(text: string | null | undefined): MarkerBlock[] {
  if (typeof text !== "string" || text === "") return [];

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkerBlock[] = [];
  let current: { marker: string; headline: string; lines: string[] } | null = null;

  const flush = () => {
    if (current === null) return;
    const fields: Record<string, string> = {};
    const body: string[] = [];
    for (const line of current.lines) {
      const field = FIELD_LINE.exec(line);
      if (field) {
        const key = (field[1] as string).trim().toLowerCase();
        if (!(key in fields)) fields[key] = field[2] as string;
        continue;
      }
      body.push(line);
    }
    blocks.push({
      marker: current.marker,
      headline: current.headline,
      fields,
      body: body.join("\n").trim(),
    });
    current = null;
  };

  for (const line of lines) {
    const marker = MARKER_LINE.exec(line);
    if (marker) {
      flush();
      current = {
        marker: (marker[1] as string).toLowerCase(),
        headline: (marker[2] as string).trim(),
        lines: [],
      };
      continue;
    }
    if (current !== null) current.lines.push(line);
  }
  flush();

  return blocks;
}

/** The first block with this marker, or `null`. */
export function findMarker(text: string | null | undefined, marker: string): MarkerBlock | null {
  return parseMarkers(text).find((block) => block.marker === marker) ?? null;
}

/**
 * A question's answer buttons, from its `options:` field.
 *
 * Pipe-separated because the answers are short phrases that routinely contain
 * commas ("client id, falling back to ts"). Capped at six: past that it is not
 * a batched question, it is a design review, and the honest move is to open the
 * issue rather than render a wall of buttons.
 */
export function questionOptions(block: MarkerBlock): string[] {
  const raw = block.fields["options"];
  if (raw === undefined) return [];
  return raw
    .split("|")
    .map((option) => option.trim())
    .filter((option) => option !== "")
    .slice(0, 6);
}

/**
 * A decider's confidence, normalized to the three values the pill renders.
 * Anything else (or nothing) is `null` — an unrecognized confidence must read
 * as "unstated", never as "high".
 */
export function deciderConfidence(block: MarkerBlock): "high" | "medium" | "low" | null {
  const raw = block.fields["confidence"]?.trim().toLowerCase();
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return null;
}
