---
"@supa-media/dev-assistant": patch
---

Fix the consumer-facing Convex type surface of the functions `createDevAssistant`
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
