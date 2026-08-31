# @supa-media/linter

## 1.0.1

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

## 1.0.0

### Major Changes

- f8bd26b: First stable release. The framework's packages are now published to GitHub
  Packages with changesets-managed versions and CHANGELOGs; consumers pin
  `^1.0.0` and update via `pnpm update @supa-media/*`.

### Patch Changes

- adc1427: Fix the shareable preset (`@supa-media/linter/preset`) and the legacy
  `configs.recommended` export registering the plugin under the `@supa`
  namespace while every rule id used the `@supa-media/` prefix. ESLint's flat
  config resolver matches rule ids against exactly the namespace a plugin is
  registered under, so this mismatch made every rule unresolvable out of the
  box (`Could not find plugin "@supa-media"`) — consumers had to manually
  re-register the plugin under `@supa-media` just to use the preset.

  Both exports now register the plugin under `@supa-media`, matching its rule
  ids and the package's npm scope. Also fixed the `create-supa-app` mobile
  template's `eslint.config.js`, which imported the plugin object from
  `@supa-media/linter` and spread it as if it were the preset's flat-config
  array (it isn't iterable) — it now imports `@supa-media/linter/preset` as
  documented.

  Added a regression test (`packages/linter/test/preset.test.js`, run via
  `node --test`) asserting every rule id in the preset and in
  `configs.recommended` resolves to a rule actually registered on a plugin
  under the same namespace.
