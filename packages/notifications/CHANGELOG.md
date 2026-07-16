# @supa-media/notifications

## 1.0.1

### Patch Changes

- 8bb7e9a: Fix extension-less relative ESM import/export specifiers in the compiled
  `dist/*.js` output (e.g. `from "./defineConfig"` instead of
  `from "./defineConfig.js"`), which broke Node's strict ESM resolution for
  any consumer that `require()`s or `import()`s the built package directly.

  The root cause was structural, not a one-off typo: the root `tsconfig.json`
  compiles with `"module": "ESNext"` and `"moduleResolution": "bundler"`.
  `tsc` never rewrites relative specifiers at emit time, and `moduleResolution:
"bundler"` happily accepts extension-less relative imports in TS source
  (the way a bundler like Metro/webpack would), so they were emitted verbatim
  into `dist/*.js`. Real Node ESM resolution (used e.g. by `tsx/cjs` when the
  first consumer, events-os, loads `supa.config.ts` via `require("@supa-media/
core/config")`) has no bundler-style extension/directory-index fallback and
  throws `ERR_MODULE_NOT_FOUND` the moment it hits one of these specifiers.
  This was invisible to `tsc`, to typecheck, and to the JS bundle — it only
  surfaced when a real Node process tried to load the built output, and in
  events-os's `scripts/dev.js` it degraded silently to a caught warning +
  default config, so `supa.config.ts` values (`vault: "Events"`,
  `easProjectId`, etc.) were never actually applied at runtime.

  Fixed by adding explicit `.js` extensions to every relative import/export
  specifier in the affected packages' TS source (valid under
  `moduleResolution: "bundler"`, and the standard convention for
  `node16`/`nodenext`-compatible ESM output) — directory imports resolve to
  `/index.js`. `@supa-media/testing` was audited and is unaffected (its
  `tsconfig.json` overrides to `module: "commonjs"` / `moduleResolution:
"node"`, so it emits `require()` calls, which don't need extensions).
  `@supa-media/convex` ships raw `.ts` source with no build step (consumed
  directly by Convex's own bundler) and is also unaffected.

  Added a regression test to each fixed package (`__tests__/esm-resolution.test.js`,
  run via `node --test`) that statically re-runs Node's strict ESM resolution
  algorithm over the built `dist/` output and fails if any relative specifier
  doesn't resolve to an exact, extension-ful file on disk. `@supa-media/core`
  additionally gets an integration test (`__tests__/config-subpath.test.js`)
  that does a real `import()` of the built `./config` subpath — the exact
  resolution path a consumer's `supa.config.ts` hits — mirroring the reported
  bug directly.

## 1.0.0

### Major Changes

- f8bd26b: First stable release. The framework's packages are now published to GitHub
  Packages with changesets-managed versions and CHANGELOGs; consumers pin
  `^1.0.0` and update via `pnpm update @supa-media/*`.
