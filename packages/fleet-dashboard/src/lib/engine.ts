/**
 * Read a gardener's agent engine out of its gh-aw markdown frontmatter.
 *
 * gh-aw accepts two shapes, both seen in the wild:
 *
 *   engine: claude                 # scalar — just the engine id
 *
 *   engine:                        # mapping — id plus optional model/extras
 *     id: custom
 *     model: qwen3-coder:480b
 *
 * The mapping form is how an OpenAI-compatible endpoint (Ollama Cloud, a local
 * gateway) is pointed at a specific model, which is the thing worth seeing on
 * the dashboard: two gardeners can both say "custom" and cost wildly different
 * amounts depending on the model behind them.
 *
 * Best-effort by design — an unrecognized shape yields nulls and the table
 * shows "—" rather than guessing. Only the frontmatter block is scanned, so a
 * fenced code sample containing `engine:` in the prose body can't spoof it.
 */

export interface EngineConfig {
  /** e.g. `claude`, `copilot`, `codex`, `custom`. */
  id: string | null;
  /** e.g. `gpt-5`, `qwen3-coder:480b`. */
  model: string | null;
}

/** Strip surrounding quotes and a trailing `# comment`. */
function scalar(raw: string): string | null {
  const withoutComment = raw.replace(/\s+#.*$/, "").trim();
  const unquoted = /^"(.*)"$|^'(.*)'$/.exec(withoutComment);
  const value = (unquoted?.[1] ?? unquoted?.[2] ?? withoutComment).trim();
  return value === "" ? null : value;
}

/** Normalize a gh-aw source: strip the BOM, collapse CRLF. */
function normalize(markdown: string): string {
  return markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/** The YAML frontmatter block, or null when the document has none. */
export function frontmatter(markdown: string): string | null {
  // Strip the BOM and normalize CRLF. Without the CRLF pass the block extracts
  // fine but every downstream regex fails on the trailing `\r` (`.` doesn't
  // match it, and `$` won't match before it), so a CRLF file silently reads as
  // "no engine" — indistinguishable from a genuinely undeclared one. Reachable
  // through this app's own ✎ path: GitHub's web editor plus a `.gitattributes`
  // `eol=crlf` produces exactly such a file.
  const normalized = normalize(markdown);
  if (!normalized.startsWith("---")) return null;

  const lines = normalized.split("\n");
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i] as string)) return lines.slice(1, i).join("\n");
  }
  return null;
}

/** A top-level scalar key in the frontmatter, e.g. `model: deepseek-v4-flash`. */
function topLevel(block: string, key: string): string | null {
  const match = new RegExp(`^${key}:(.*)$`, "m").exec(block);
  return match === null ? null : scalar(match[1] as string);
}

export function parseEngine(markdown: string): EngineConfig {
  const block = frontmatter(markdown);
  if (block === null) return { id: null, model: null };

  // gh-aw accepts `model:` as a TOP-LEVEL key as well as inside the engine
  // mapping, and every real gardener in this fleet uses the top-level form
  // (`engine: {id: codex, env: …}` + `model: deepseek-v4-flash`). v1 only
  // looked inside the mapping, so the column that exists to make an expensive
  // model obvious rendered `codex` for all of them.
  const declaredModel = topLevel(block, "model");

  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    // Top-level key only — an `engine:` nested under another key isn't ours.
    const match = /^engine:(.*)$/.exec(line);
    if (!match) continue;

    const inline = scalar(match[1] as string);
    if (inline !== null) return { id: inline, model: declaredModel };

    // Mapping form: consume the indented block that follows.
    let id: string | null = null;
    let model: string | null = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      const child = lines[j] as string;
      if (child.trim() === "" || child.trim().startsWith("#")) continue;
      if (!/^\s/.test(child)) break; // de-indented — the engine block ended.

      const entry = /^\s+([A-Za-z0-9_-]+):(.*)$/.exec(child);
      if (!entry) continue;
      const key = entry[1] as string;
      if (key === "id") id = scalar(entry[2] as string);
      else if (key === "model") model = scalar(entry[2] as string);
    }
    // The nested model wins when both are declared: it is the more specific
    // statement, and a disagreement is the author's bug, not ours to average.
    return { id, model: model ?? declaredModel };
  }

  return { id: null, model: declaredModel };
}

/* ── Spend caps ─────────────────────────────────────────────────────────── */

export interface GardenerCaps {
  /** `max-ai-credits`, converted to USD. */
  perRunUsd: number | null;
  /** `max-daily-ai-credits`, converted to USD. */
  perDayUsd: number | null;
  /** `max-turns`, straight through. */
  maxTurns: number | null;
}

/**
 * gh-aw meters spend in **AI Credits**, and 1 AIC = $0.01 USD. The gardeners in
 * this fleet state the conversion in their own comments (`max-ai-credits: 200
 * # ~$2.00 per run`), so showing the credits raw would make the reader do the
 * arithmetic the file already did.
 */
const USD_PER_AI_CREDIT = 0.01;

function integerKey(block: string, key: string): number | null {
  const raw = topLevel(block, key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The per-run / per-day spend ceilings a gardener declares.
 *
 * Read from the source markdown rather than the compiled lock file because
 * these are authored values a human edits — and the ✎ deep link beside them
 * goes to that same file, so what is shown and what is edited are the same
 * text.
 */
export function parseCaps(markdown: string): GardenerCaps {
  const block = frontmatter(markdown);
  if (block === null) return { perRunUsd: null, perDayUsd: null, maxTurns: null };

  const perRun = integerKey(block, "max-ai-credits");
  const perDay = integerKey(block, "max-daily-ai-credits");
  return {
    perRunUsd: perRun === null ? null : perRun * USD_PER_AI_CREDIT,
    perDayUsd: perDay === null ? null : perDay * USD_PER_AI_CREDIT,
    maxTurns: integerKey(block, "max-turns"),
  };
}

/**
 * Everything below the frontmatter — the instructions the model actually gets.
 *
 * Returned verbatim (not rendered) because the point of showing it is to review
 * what was written, and markdown rendering would quietly hide a stray fence or
 * a broken heading, which is exactly the class of mistake worth catching here.
 */
export function promptBody(markdown: string): string {
  const normalized = normalize(markdown);
  const block = frontmatter(normalized);
  if (block === null) return normalized.trim();

  // Skip the opening `---`, the block itself, and the closing `---`.
  const lines = normalized.split("\n");
  const closing = 1 + block.split("\n").length;
  return lines.slice(closing + 1).join("\n").trim();
}

/** `claude`, `custom · qwen3-coder:480b`, or `—` when nothing is declared. */
export function formatEngine(engine: EngineConfig): string {
  if (engine.id === null && engine.model === null) return "—";
  if (engine.model === null) return engine.id ?? "—";
  if (engine.id === null) return engine.model;
  return `${engine.id} · ${engine.model}`;
}
