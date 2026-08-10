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

  /**
   * Fallback GitHub token, used for any owner with no `GH_TOKEN_<OWNER>`.
   *
   * Optional, because a fine-grained PAT is scoped to exactly one resource
   * owner and the fleet spans three — the per-owner secrets below are the
   * supported setup. This is what a classic PAT (which already spans every
   * owner the account can reach) needs, and it is the migration path from the
   * single-token version.
   */
  GH_TOKEN?: string;

  /**
   * Per-owner GitHub tokens: `GH_TOKEN_TOGATHERNYC`, `GH_TOKEN_SUPA_MEDIA`,
   * `GH_TOKEN_SHYOH`. Each is a fine-grained PAT for that owner's fleet repos,
   * with `issues:write` + `contents:read`.
   *
   * A pattern index signature rather than three named fields: the owners come
   * from `fleet.ts`, so naming them here too would be a second list that can
   * disagree with the first. `github.ts` derives the key with `tokenEnvKey`.
   */
  [perOwnerGitHubToken: `GH_TOKEN_${string}`]: string | undefined;
}
