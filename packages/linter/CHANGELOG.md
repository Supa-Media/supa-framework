# @supa-media/linter

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
