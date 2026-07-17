# @supa-media/dev-assistant

## 2.0.0

### Major Changes

- 8c5784e: Replace the `createDevAssistant(config)` factory with a module-level config
  holder + module-level function consts. **Breaking change to the mounting
  contract.**

  **Why (the lesson worth keeping):** Convex builds a consumer's typed
  `api`/`internal` purely by static inference —
  `ApiFromModules → FunctionReferenceFromExport → FilterApi<…, FunctionReference<any, "internal" | "public">>`.
  A function survives onto its visibility partition (with concrete args) **only if
  its `typeof` is a genuine builder output** produced directly by a `*Generic`
  builder at module scope. When ~48 functions flowed through the factory's single
  large **inferred** return type, TypeScript **widened each function's phantom
  visibility parameter** from its `"internal"`/`"public"` literal to the whole
  `FunctionVisibility` union — which matches **neither** partition predicate, so
  every function was dropped from **both** `api` and `internal` on a
  strict-typechecked consumer. This was proven exhaustively (re-mapping,
  annotation, and re-pinning the type at every layer all fail — only a real
  builder const survives `infer Visibility`).

  **What changed:**
  - **Removed** `createDevAssistant` / `DevAssistantInstance` (no deprecated shim —
    a shim would reintroduce the exact widening for its users).
  - **Added** `setDevAssistantConfig(config)` / `getDevAssistantConfig()` /
    `getDevAssistantRefs()`. Config validation/defaults are unchanged
    (`resolveConfig`/`validateConfig` reused); the config shape is identical.
  - Every function in `functions/{bugs,actions,contributions,maintainers}` is now a
    **module-level const** built directly with the `*Generic` builders, reading
    config lazily inside its handler. New subpath exports
    `@supa-media/dev-assistant/functions/{bugs,actions,contributions,maintainers}`.
  - `registerRoutes(http)` (was `instance.registerRoutes`) and
    `registerDevAssistantCrons(crons)` (was `(crons, instance.config)`) read the
    holder.

  **Consumer migration:** add a `config.ts` that calls `setDevAssistantConfig({…})`;
  in each re-export file `import "./config"` (side effect) then
  `export { … } from "@supa-media/dev-assistant/functions/<module>"` — no casts.
  Also ensure `convex` resolves to a **single** install (a duplicated peer-keyed
  `convex` re-triggers the widening across the package boundary). See the README's
  "Why a config holder, not a factory" and "Mounting" sections.

### Patch Changes

- 49fff50: Fix the consumer-facing Convex type surface of the functions `createDevAssistant`
  returns.
  - **Arg types no longer collapse to `any`.** Handlers were authored
    `(ctx: any, args: any)` and the pipeline enum validators were cast `as any`,
    so every re-exported function typed as `Registered…<Vis, any, …>` and lost its
    argument types on the consumer's generated `api`/`internal`. Handlers now infer
    their args from the real `v.*` validators (`ctx` stays `any`, which is
    invisible to the API surface), and the `as any` validator casts are removed.
  - **`supaDevAssistantTables()` keeps its concrete table keys.** It was annotated
    `Record<string, TableDefinition>`, which erased `devBugs`/`devBugMessages` from
    a consumer's `DataModel`. It is now generic over `extraBugFields` and returns a
    precisely-keyed object.
  - **First compiler gate + type-level regression tests.** Adds `@types/node`, a
    `typecheck` script, and `test/*.test-d.ts` (wired into `pnpm test`) so the
    package is `tsc`-checked and the arg-collapse cannot silently return.

  Note: a separate, deeper defect remains — the factory's inferred return type
  widens each function's phantom visibility parameter to the full
  `FunctionVisibility` union, dropping the functions from the consumer's
  visibility-partitioned `api`/`internal`. Its reliable fix is to expose the
  functions as module-level consts rather than factory-returned; see the PR for the
  full analysis.

## 1.0.0

### Major Changes

- c57402a: First stable release of `@supa-media/dev-assistant`: an "app improves itself"
  control plane for Convex apps — an AI-driven contribution pipeline (spec →
  build → review → fix → merge → deploy) extracted from Togather's
  `devAssistant` module (ADR-029).

  Package version starts at `0.0.0` (unpublished) with a `major` changeset, so
  this bump lands the first release at exactly `1.0.0` — same convention used
  for the framework's original v1.0.0 cut (#12): a `minor` bump on an
  already-`1.0.0` `package.json` would have skipped straight to `1.1.0` on
  first publish.
  - `createDevAssistant(config)` factory (mirrors `createSupaAuth`) returning the
    Convex queries/mutations/actions and an HTTP route registrar for
    `/dev-assistant/callback`, `/dev-assistant/upload`, and `/github/webhook`.
  - `supaDevAssistantTables()` composable schema (`devBugs` + `devBugMessages`),
    extensible with a consumer's chat-origination columns.
  - A pure, unit-tested pipeline core (`@supa-media/dev-assistant/pipeline`): the
    monotonic status machine, per-run-mode callback policy, severity-capped
    auto-merge gate, HMAC signature verification, and GitHub REST helpers.
  - Injection seams for the only app-specific parts — auth, role gate, notifier
    (push/chat), media/upload resolvers, repo/GitHub config, and a configurable
    HMAC header (default `x-supa-signature`).
  - `templates/ROUTINE-PROMPT.md` — the three Claude Code Routine prompts with
    documented `{{PLACEHOLDER}}` substitutions.
