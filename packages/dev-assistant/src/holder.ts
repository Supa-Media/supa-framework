/**
 * Config holder — the module-level singleton that supplies every dev-assistant
 * function its resolved config and internal function references.
 *
 * WHY THIS EXISTS (the architecture the whole package is shaped around): Convex
 * builds a consumer's typed `api`/`internal` purely by static type inference
 * (`ApiFromModules` → `FunctionReferenceFromExport` → `FilterApi`). A function
 * survives that pipeline onto the right visibility partition ONLY if its
 * `typeof` is a GENUINE builder output — `Registered{Query,Mutation,Action}`
 * produced directly by a `*Generic` builder at module scope. When the functions
 * instead flow through a factory's single large inferred return type (the old
 * `createDevAssistant(config)` shape), TypeScript widens each function's phantom
 * visibility parameter from its concrete `"internal"`/`"public"` literal to the
 * whole `FunctionVisibility` union, and the function is dropped from BOTH the
 * consumer's `api` and `internal` objects. This was proven exhaustively in
 * supa-framework PR #27 (re-mapping/annotation/pinning the type all fail — only
 * a real builder const survives).
 *
 * The fix: every function is a module-level const built directly with the
 * `*Generic` builders (see `functions/{bugs,actions,contributions,maintainers}.ts`),
 * and reads its config LAZILY, inside its handler, via `getDevAssistantConfig()`.
 * The consumer sets the config once from a small config module that they import
 * for its side effect before any function runs:
 *
 * ```ts
 * // convex/functions/devAssistant/config.ts
 * import { setDevAssistantConfig } from "@supa-media/dev-assistant";
 * setDevAssistantConfig({ functionsPath: "functions/devAssistant", … });
 *
 * // convex/functions/devAssistant/bugs.ts
 * import "./config"; // side-effect: guarantees config is set first
 * export { getBug, applyCallback, … } from "@supa-media/dev-assistant/functions/bugs";
 * ```
 *
 * Because the re-exported consts are genuine builder outputs, the consumer's
 * generated `api`/`internal` types survive.
 */

import {
  resolveConfig,
  type DevAssistantConfig,
  type ResolvedDevAssistantConfig,
} from "./config";
import { makeRefs, type DevAssistantRefs } from "./functions/refs";

interface HolderState {
  config: ResolvedDevAssistantConfig;
  refs: DevAssistantRefs;
}

let state: HolderState | undefined;

const UNSET_MESSAGE =
  "[@supa-media/dev-assistant] Config not set. A consumer config module must " +
  "call setDevAssistantConfig({ … }) and be imported for its side effect BEFORE " +
  "any dev-assistant function runs. The standard wiring is a config module " +
  '(e.g. `convex/functions/devAssistant/config.ts`) that calls ' +
  "setDevAssistantConfig(), imported at the top of every " +
  "functions/devAssistant/{bugs,actions,contributions,maintainers}.ts re-export " +
  'file (`import "./config";`). See the package README ("Mounting").';

/**
 * Set the resolved config + internal refs for every dev-assistant function.
 * Call this exactly once, from the consumer's config module, before any function
 * handler executes. Validates/defaults via `resolveConfig` (unchanged rules).
 * Returns the resolved config for convenience. Calling it again replaces the
 * config (last call wins) — useful for tests.
 */
export function setDevAssistantConfig(
  config: DevAssistantConfig,
): ResolvedDevAssistantConfig {
  const resolved = resolveConfig(config);
  state = { config: resolved, refs: makeRefs(resolved.functionsPath) };
  return resolved;
}

/**
 * The resolved config, read lazily inside function handlers. Throws a
 * descriptive error (naming the setup step) if `setDevAssistantConfig` was never
 * called — which in practice means a re-export file forgot its `import "./config"`
 * side-effect import.
 */
export function getDevAssistantConfig(): ResolvedDevAssistantConfig {
  if (!state) throw new Error(UNSET_MESSAGE);
  return state.config;
}

/**
 * The internal function references (`${functionsPath}/…`) the pipeline schedules
 * against, read lazily inside handlers. Same unset-guarantee as
 * `getDevAssistantConfig`.
 */
export function getDevAssistantRefs(): DevAssistantRefs {
  if (!state) throw new Error(UNSET_MESSAGE);
  return state.refs;
}

/** Test-only: clear the holder so an unset-state assertion can run in isolation. */
export function __resetDevAssistantConfigForTests(): void {
  state = undefined;
}
