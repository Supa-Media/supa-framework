/**
 * `@supa-media/dev-assistant` — an "app improves itself" control plane for
 * Convex apps. An AI-driven contribution pipeline (spec → build → review → fix →
 * merge → deploy) with a monotonic status machine, a signed Routine callback,
 * per-run-mode callback policy, severity-capped policy auto-merge, and a
 * staging-verification loop. Ported from Togather's devAssistant (ADR-029).
 *
 * See `./schema` for the composable tables and `./pipeline` for the pure core.
 */

// Config holder — the mounting contract's entry point. A consumer config module
// calls `setDevAssistantConfig({...})` once; the function modules read it lazily.
// (Replaces the removed `createDevAssistant` factory — see `./holder` for why
// factory-returned Convex functions are dropped from a consumer's api/internal.)
export {
  setDevAssistantConfig,
  getDevAssistantConfig,
  getDevAssistantRefs,
} from "./holder";

// HTTP route registrar (`/dev-assistant/callback`, `/upload`, `/github/webhook`).
// Reads the holder; call from the consumer's `http.ts` after config is set.
export { registerRoutes } from "./functions/http";

export {
  registerDevAssistantCrons,
  RECONCILE_CRON_NAME,
  RECONCILE_CRON_SCHEDULE,
} from "./functions/crons";

export { validateMount, assertMounted } from "./functions/validateMount";

export {
  resolveConfig,
  validateConfig,
  DEFAULT_SIGNATURE_HEADER,
  DEFAULT_AREAS,
} from "./config";
export type {
  DevAssistantConfig,
  ResolvedDevAssistantConfig,
  RoleGateCtx,
  UploadCtx,
  UploadArgs,
} from "./config";

export { noopNotifier } from "./notifier";
export type {
  DevAssistantNotifier,
  DevAssistantEvent,
  DevBugDoc,
  NotifierCtx,
} from "./notifier";

export { supaDevAssistantTables } from "./schema";
export type { DevAssistantTablesConfig } from "./schema";

// The pure pipeline core (also available at `@supa-media/dev-assistant/pipeline`).
export * from "./pipeline";
export type { RepoConfig } from "./pipeline/github";
