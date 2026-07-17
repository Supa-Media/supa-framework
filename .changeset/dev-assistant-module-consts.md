---
"@supa-media/dev-assistant": major
---

Replace the `createDevAssistant(config)` factory with a module-level config
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
