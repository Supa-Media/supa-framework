/**
 * The Cloudflare bindings and secrets this worker needs.
 *
 * The binding interfaces are hand-rolled rather than pulled from
 * `@cloudflare/workers-types`. Two reasons, both practical: this worker touches
 * exactly three binding methods (`KV.get`, `KV.put`, `AI.run`), and the full
 * workers-types package declares global `fetch`/`Request`/`Response` that
 * collide with `@types/node`'s in the single `tsconfig.typecheck.json` pass
 * that compiles `src` and `test` together. Thirty lines here buys a
 * dependency-free package and one compiler configuration. If this worker ever
 * needs D1, R2, Durable Objects, or queues, take the dependency instead of
 * growing this file.
 *
 * Every field below is either declared in `wrangler.jsonc` (bindings) or set
 * with `wrangler secret put` (secrets). Secrets are NEVER committed — see
 * README.md.
 */

/** The subset of Workers KV this worker uses. */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** Whisper's response shape. `text` is absent when the audio decoded to silence. */
export interface WhisperResult {
  text?: string;
}

/** The subset of the Workers AI binding this worker uses. */
export interface WorkersAI {
  run(
    model: "@cf/openai/whisper",
    input: { audio: number[] },
  ): Promise<WhisperResult>;
}

/** The subset of the module-worker execution context this worker uses. */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  /** Workers AI binding — transcription. `wrangler.jsonc` → `ai`. */
  AI: WorkersAI;
  /** KV namespace holding `learnings.md`. `wrangler.jsonc` → `kv_namespaces`. */
  INBOX_KV: KVNamespace;

  /** BotFather token for the inbox bot. */
  TELEGRAM_BOT_TOKEN: string;
  /** Shared secret echoed by Telegram in `X-Telegram-Bot-Api-Secret-Token`. */
  TELEGRAM_WEBHOOK_SECRET: string;
  /** The ONE chat id allowed to drive this worker. Everything else is dropped. */
  TELEGRAM_CHAT_ID: string;
  /** Anthropic API key used for extraction only. */
  ANTHROPIC_API_KEY: string;
  /** Fine-grained PAT: the four fleet repos, `issues:write` + `contents:read`. */
  GH_TOKEN: string;
}
