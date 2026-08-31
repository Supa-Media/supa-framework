# @supa-media/linter

**An ESLint plugin that enforces the Supa framework's Expo/React Native
conventions** — native dependency gating, Expo Router file structure, and
platform-file pairing — as lint errors at the point where you write them, rather
than as a CI failure or a crash on device.

One rule (`no-ungated-native-import`) is the editor-time sibling of
[`@supa-media/native-safety`](https://github.com/Supa-Media/supa-framework/tree/main/packages/native-safety)'s `check-native-imports` CLI. The
rest encode structural conventions that Expo Router and Metro punish at runtime.

## Install

```
pnpm add -D @supa-media/linter
```

Peer dependency:

```
pnpm add -D eslint
```

ESLint 8 or newer. `@typescript-eslint/parser` is optional — the preset wires it
up if it is installed and silently skips the TS parser block if it is not.

## Use the preset

Flat config (`eslint.config.js`), as shipped in the `create-supa-app` mobile
template:

```js
import supaPreset from "@supa-media/linter/preset";

export default [
  ...supaPreset,
  {
    ignores: ["metro.config.js", "babel.config.js"],
  },
];
```

The preset is a **flat-config array** of three blocks: the plugin registration
plus rule severities, an `ignores` block (`node_modules`, `dist`, `.expo`,
`.next`, `build`, `coverage`, `*.config.js`, `*.config.ts`), and a TS parser block
for `**/*.ts`/`**/*.tsx`.

Legacy `.eslintrc` config:

```json
{
  "extends": ["plugin:@supa-media/recommended"]
}
```

> **⚠️ The preset is an array; the package's default export is not.**
> `import supaPlugin from "@supa-media/linter"` gives you the plugin object
> (`{ meta, rules, configs }`), which is **not iterable** — spreading it into a
> flat config throws. Import `@supa-media/linter/preset` for the config,
> `@supa-media/linter` only if you are registering rules by hand.

## Rules

Severities below are the preset's defaults; every rule can be re-configured in a
later flat-config block.

| Rule | Default | Flags |
| --- | --- | --- |
| `@supa-media/no-ungated-native-import` | error | Static import of a native dependency classified `gated` |
| `@supa-media/route-file-no-logic` | warn | A file under `app/` carrying more than 30 lines of logic |
| `@supa-media/require-layout-file` | warn | A nested `app/` directory with route files but no `_layout` |
| `@supa-media/keyboard-aware-forms` | warn | A component rendering 2+ `TextInput`s without `KeyboardAwareFormContainer` |
| `@supa-media/platform-file-pairs` | warn | A file using a native-only `react-native` API with no `.web.*` counterpart |

### `no-ungated-native-import`

A gated native dependency is one that may not exist in the native binary the user
already has installed, so it must be reached dynamically behind a runtime check.
This rule reports:

- any `import`/`export … from` of a gated package or one of its subpaths, and
- a **top-level** `require()` of one. A `require()` inside an `if`, a ternary, or
  any function body is treated as guarded and allowed — that is the intended
  escape hatch.

Options: `nativeDepsPath` (explicit config path) and `allowedFiles` (your gating
wrappers). Without `nativeDepsPath` the rule walks up from the linted file to find
`native-deps.json`. Allowlist entries are matched as **substrings** of the
absolute filename, so a bare `SafeLinearGradient.tsx` exempts every path
containing it.

> **⚠️ This rule reads a different `native-deps.json` shape than the
> `@supa-media/native-safety` CLIs do, and disables itself silently on theirs.**
> The CLIs (and `@supa-media/testing`) expect `{ "core": [...], "gated": [...] }`.
> This rule expects a **map** of package name to classification, optionally under
> a `dependencies` key:
>
> ```json
> {
>   "expo-av": "gated",
>   "expo-blur": { "classification": "gated", "allowedFiles": ["SafeBlur.tsx"] }
> }
> ```
>
> Handed the array form, it finds zero gated packages and returns an empty
> visitor — no error, no warning, no coverage. The same is true if
> `native-deps.json` is missing or unparseable. Until the shapes converge, keep
> the CLI in CI as the load-bearing gate and treat this rule as the editor
> convenience.

### `route-file-no-logic`

Route files under `app/` should be thin — a re-export of a screen that lives in
`features/`. The rule counts lines that are not blank, not `import …`, not
`export { …`, not `export default …`, and not comments; more than `maxLines`
(default 30) is a report. Options: `maxLines`, `appDirectory` (default `app`).
`_layout*` files are skipped — configuration legitimately lives there.

### `require-layout-file`

Every directory nested under `app/` that contains route files needs a
`_layout.tsx` (or `.ts`/`.jsx`/`.js`). Without one, Expo Router can flatten child
routes or throw "Maximum update depth exceeded" from mismatched navigator screen
names. The `app/` root itself is not checked. Option: `appDirectory`.

### `keyboard-aware-forms`

A component whose returned JSX contains `minInputs` (default 2) or more
`TextInput` elements, with no `KeyboardAwareFormContainer` anywhere in that tree,
is reported. If the file imports `KeyboardAwareFormContainer` from
`@supa-media/core/forms`, the rule stands down for that file entirely. Option:
`minInputs`.

### `platform-file-pairs`

If a file imports any of `NativeModules`, `NativeEventEmitter`,
`requireNativeComponent`, `UIManager`, `PermissionsAndroid`, `ToastAndroid`,
`BackHandler`, `Vibration`, `AccessibilityInfo`, or `Alert` from `react-native`,
it should have a sibling `.web.ts`/`.web.tsx`/`.web.js`/`.web.jsx` that Metro
resolves instead when bundling for web. `.web.*` files and `.test`/`.spec` files
are skipped. Option: `additionalNativeAPIs`.

> **⚠️ `require-layout-file` and `platform-file-pairs` hit the filesystem.**
> Both answer "does this sibling file exist?" with `fs.existsSync` against what is
> on disk at lint time. In an editor, an unsaved new `_layout.tsx` or `.web.ts`
> does not count until you save it.

## In CI

The framework's reusable `ci.yml` runs whatever `lint-command` you pass:

```yaml
    uses: Supa-Media/supa-framework/.github/workflows/ci.yml@v1
    with:
      lint-command: pnpm --filter mobile lint
      lint-continue-on-error: false
```

`lint-continue-on-error` defaults to **`true`** in that workflow — set it to
`false` if you want `no-ungated-native-import` to actually block a merge, or keep
the `check-native-imports` CLI as the blocking gate and let lint stay advisory.

The mobile template's script is simply `"lint": "eslint ."`.

## Testing

`node --test` runs the preset regression suite: every rule id in both `preset.js`
and `configs.recommended` must resolve to a rule actually registered on a plugin
under the same namespace, and the two exports must agree on that namespace. It
exists because an earlier release registered the plugin as `@supa` while every
rule id said `@supa-media/`, which made the preset unusable out of the box.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework.
MIT licensed.
