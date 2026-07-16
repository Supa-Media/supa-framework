# @supa-media/testing

## 1.0.0

### Major Changes

- f8bd26b: First stable release. The framework's packages are now published to GitHub
  Packages with changesets-managed versions and CHANGELOGs; consumers pin
  `^1.0.0` and update via `pnpm update @supa-media/*`.

### Minor Changes

- 877eb6f: Redesign the `react-resolution` guard to be pnpm-linker-agnostic (fixes false failures under `node-linker=hoisted`).

  **The bug:** the old guard asserted that `react`/`react-dom` physically exist at `apps/mobile/node_modules/react(-dom)` — an app-local copy. Under pnpm's `node-linker=hoisted` (which Metro-based apps use), every dependency hoists to the workspace-root `node_modules` and no app-local copy is ever created, so a perfectly healthy install failed the guard. Consumers worked around it with a postinstall symlink hack that re-materialized fake app-local copies after every install.

  **The fix:** the guard now resolves React the way Node/Metro actually would and compares by **version**, not by file path (under the hoisted linker pnpm hard-links the same `react@X` to multiple paths, so path comparison false-positives). New semantics:
  1. **Native-graph single React** — resolve `react` from the app dir and from each native package's own dir (`react-native`, `expo-modules-core`, `react-native-web`); all must resolve to the same React version the app renders with. A native package keyed to a different React is the exact runtime hazard (re-keys the Expo native-module graph → blank native video/GIF on device, invisible to CI). This mirrors Togather's battle-tested `check-react-consistency.js`.
  2. **No duplicate React in the install** — scan the pnpm virtual store (`node_modules/.pnpm/react@*`, present under both linkers) for distinct React versions.
  3. **react / react-dom agree** on major.minor (retained).

  **API:** unchanged and backward compatible. `checkReactResolution(projectRoot)` and `testReactResolution(projectRoot)` keep their signatures; both now accept an optional `ReactResolutionOptions` (`{ nativePackages }`), and `createSupaTests` accepts an optional `reactNativePackages`. The `ReactResolutionResult` gains `nativeGraph` and `reactVersionsInStore` fields. No consumer test-file changes are required.

  **Behavioral note (not an API break):** the guard no longer requires an app-local `node_modules/react` copy. Consumers on `node-linker=hoisted` can delete their `ensure-local-react.mjs` postinstall symlink hack once this ships. Verified against the real events-os install (passes without relying on the symlinks) plus synthetic hoisted/isolated/dual-React fixtures now committed as tests.
