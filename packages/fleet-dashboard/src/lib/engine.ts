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

/** The YAML frontmatter block, or null when the document has none. */
export function frontmatter(markdown: string): string | null {
  // Strip the BOM and normalize CRLF. Without the CRLF pass the block extracts
  // fine but every downstream regex fails on the trailing `\r` (`.` doesn't
  // match it, and `$` won't match before it), so a CRLF file silently reads as
  // "no engine" — indistinguishable from a genuinely undeclared one. Reachable
  // through this app's own ✎ path: GitHub's web editor plus a `.gitattributes`
  // `eol=crlf` produces exactly such a file.
  const normalized = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---")) return null;

  const lines = normalized.split("\n");
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i] as string)) return lines.slice(1, i).join("\n");
  }
  return null;
}

export function parseEngine(markdown: string): EngineConfig {
  const block = frontmatter(markdown);
  if (block === null) return { id: null, model: null };

  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    // Top-level key only — an `engine:` nested under another key isn't ours.
    const match = /^engine:(.*)$/.exec(line);
    if (!match) continue;

    const inline = scalar(match[1] as string);
    if (inline !== null) return { id: inline, model: null };

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
    return { id, model };
  }

  return { id: null, model: null };
}

/** `claude`, `custom · qwen3-coder:480b`, or `—` when nothing is declared. */
export function formatEngine(engine: EngineConfig): string {
  if (engine.id === null && engine.model === null) return "—";
  if (engine.model === null) return engine.id ?? "—";
  if (engine.id === null) return engine.model;
  return `${engine.id} · ${engine.model}`;
}
