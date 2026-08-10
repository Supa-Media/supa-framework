/**
 * The worker's one log line shape.
 *
 * Structured JSON, and deliberately carrying no message text, chat id, or
 * transcript — Cloudflare's log tail is a place the fleet's contents should
 * never end up. An event name, a repo slug, an issue number, an error *name*:
 * that is the whole vocabulary.
 *
 * It lives in its own module because `github.ts` needs it too, and a client that
 * degrades silently is a client nobody can debug.
 */
export function log(event: string, fields: Record<string, string | number> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

/** An error's class name, safe to log — never its message, which can quote input. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
