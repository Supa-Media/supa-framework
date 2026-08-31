# @supa-media/native-safety

## 1.2.1

### Patch Changes

- cc38f27: Every package now ships an MIT LICENSE file and a README inside its tarball.

  The repo declared `"license": "MIT"` in all 13 package manifests with no LICENSE
  file anywhere, so npm rendered an MIT badge over a tarball containing no grant.
  Each package now carries a copy of the root LICENSE (a copy, not a symlink — npm
  does not follow symlinks into a tarball) with `"LICENSE"` in its `files` array.

  12 of the 13 also had no README and would have published a blank npm page; they
  now document their real public surface, peer dependencies, and constraints.

  `@supa-media/claude` additionally changes what it scaffolds. Its
  `templates/settings.json` previously wrote
  `{"permissions": {"dangerouslySkipPermissions": true}}` into the consumer's
  `.claude/` — a package that disabled the agent's permission prompts on install.
  It now ships a conservative `permissions.allow` allowlist (routine reversible
  commands: pnpm dev/test/lint/typecheck/build, `npx convex dev|run|logs`,
  read-only git and gh, plus add/commit/checkout) and denies reads of `.env*`.
  `git push`, `git reset --hard`, `gh pr merge`, `convex deploy` and `eas` are
  deliberately left to prompt; widen the allowlist for your own repo.
  `templates/hooks.json` no longer registers a `Stop` hook pointing at a
  `ralph-logger.sh` that was never shipped, and is now an empty starting point.
  Existing `.claude/settings.json` and `.claude/hooks.json` files are untouched
  unless you run `supa-claude sync --force`.

## 1.2.0

### Minor Changes

- 7c21e10: `check-react-consistency` gains a third gate: react-dom/react exact pairing.
  Every `react-dom` instance in the lockfile must be peer-keyed to its own exact
  `react` version — a skewed pair like `/react-dom@19.2.4(react@19.1.0)` fails
  the check.

  Why: react-dom's server renderer hard-errors on any react/react-dom version
  mismatch at runtime (React >= 19.2, `ensureCorrectIsomorphicReactVersion`),
  but only when something actually renders — typecheck, bundling, and
  non-rendering tests all stay green. This is exactly how Togather shipped a
  broken verification email: pinning `react` in a workspace package (to control
  pnpm's peer dedup) re-keyed the react-email tree onto the pin, while
  `react-dom` — auto-installed as a transitive peer, declared nowhere —
  stayed at the latest in-range version. The first react-email `render()` in a
  Convex action then threw in production.

  The gate parses both pnpm lockfile key shapes — v6 package keys
  (`/react-dom@X(react@Y)`) and v9+ snapshot keys (no leading slash) — so a
  skewed pair can't slip through as a silent no-op on newer lockfiles.

  The gate is lockfile-wide and independent of the app's own React pin:
  multiple distinct react-dom versions are fine as long as each matches the
  react it's keyed to (e.g. a mobile subgraph on 19.1.0 and a web subgraph on
  19.2.4). The fix it prescribes is pinning `react-dom` to the same exact
  version as `react` in the workspace package that pins react.

## 1.1.0

### Minor Changes

- 6e2998e: Add `check-react-consistency` CI script, a static/lockfile check that catches a
  second React entering an Expo app's native module graph and a denylist of
  web-only React libs (MUI, emotion, styled-components) known to cause it.

  This closes the gap next to `@supa-media/testing`'s react-resolution guard,
  which checks the actual installed `node_modules` layout at runtime — this new
  check runs earlier, against `pnpm-lock.yaml` directly, without an install.

  Ported unchanged (detection logic) from Togather's battle-tested
  `apps/mobile/scripts/check-react-consistency.js`, written after Togather's
  PR #548 shipped a regression where adding `@mui/*` + `@emotion/*` for a web
  datepicker pulled a second React into the shared pnpm lockfile via
  `autoInstallPeers`. That re-keyed `expo-modules-core` and other Expo/RN native
  packages onto the second React, which silently broke native Fabric view/module
  registration on the installed binary — video and animated GIFs rendered blank
  — while typecheck, tests, and the JS bundle all passed, because native modules
  are mocked in tests and the JS bundle doesn't care which React a native module
  is peer-keyed to. See Togather's ADR-013 postmortem for the full story.

  Usage:

  ```
  npx @supa-media/native-safety check-react-consistency \
    --pkg apps/mobile/package.json \
    --lockfile pnpm-lock.yaml \
    --config apps/mobile/native-deps.json
  ```

  `--pkg` and `--lockfile` are required and generalize Togather's hardcoded
  `apps/mobile` paths into arguments (following the `check-native-imports`
  convention). `--config` optionally points at a `native-deps.json` ({ core,
  gated }) to catch scoped native packages the name-prefix heuristic can't
  express, and its new optional `nativeUnsafeDenylist` array (or the `--denylist`
  flag) extends the default MUI/emotion/CSS-in-JS denylist with app-specific
  web-only React libraries — Togather's four-entry list ships as the default,
  unchanged.

## 1.0.0

### Major Changes

- f8bd26b: First stable release. The framework's packages are now published to GitHub
  Packages with changesets-managed versions and CHANGELOGs; consumers pin
  `^1.0.0` and update via `pnpm update @supa-media/*`.
