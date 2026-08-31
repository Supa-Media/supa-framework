# @supa-media/testing

**Static checks for Expo/React Native gotchas, packaged as functions you call from
your own test runner.** No app boot, no simulator, no test framework of its own —
each check reads files on disk and either returns a result object or throws a
descriptive error, so it drops into Jest, Vitest, or `node --test` unchanged.

Four checks: Expo Router routing conflicts, Metro web-bundle safety, React
resolution across the native graph, and native import gating.

## Install

```
pnpm add -D @supa-media/testing
```

No peer dependencies. Ships compiled CommonJS (`dist/`) with type declarations;
there is no subpath export map, so everything comes from the package root.

## Wiring it in

The `create-supa-app` mobile template registers all four with Jest:

```js
const path = require("path");
const { createSupaTests, detectRoutingConflicts } = require("@supa-media/testing");

const appDir = path.join(__dirname, "..", "app");
const tests = createSupaTests({
  appDir,
  srcDir: path.join(__dirname, ".."),
  nativeDepsPath: "native-deps.json",
});

describe("Supa framework guardrails", () => {
  test("no Expo Router URL conflicts", () => {
    const { conflicts } = detectRoutingConflicts(appDir);
    if (conflicts.length > 0) throw new Error(/* … */);
  });
  test("web bundle safety", tests.webBundleSafety);
  test("single React instance resolves", tests.reactResolution);
  test("native deps classified + no ungated native imports", tests.nativeImports);
});
```

Note what that template does **not** do: it calls `detectRoutingConflicts`
directly rather than `tests.routingConflicts`, because the bundled test function
also throws on missing `_layout.tsx` files — a softer heuristic that
false-positives on valid nested stacks. Asserting on `conflicts` alone is the
narrower signal.

## Surface

Every check comes in two forms: a `check*`/`detect*` function returning a result
object, and a `test*` function that throws a formatted error instead. The `test*`
form is the one to hand to `test()`.

| Check | Inspect | Assert |
| --- | --- | --- |
| Routing conflicts | `detectRoutingConflicts(appDir)` | `testRoutingConflicts(appDir)` |
| Web bundle safety | `checkWebBundleSafety(config)` | `testWebBundleSafety(config)` |
| React resolution | `checkReactResolution(projectRoot, options?)` | `testReactResolution(projectRoot, options?)` |
| Native imports | `checkNativeImports(config)` | `testNativeImports(config)` |

Plus two aggregators:

- **`createSupaTests(config)`** → `{ routingConflicts, webBundleSafety, reactResolution, nativeImports }`, four zero-argument functions with paths already resolved. Config: `appDir`, `srcDir` (both required), `nativeDepsPath`, `nativeImportAllowlist`, `storesDir`, `providersDir`, `nativeOnlyPatterns`, `reactNativePackages`.
- **`runAllSupaTests(config)`** → `{ passed: string[], failed: [{ name, error }] }`. Never throws — for a CI script that wants every failure in one pass before exiting.

Result and config types are exported alongside (`RoutingConflictResult`,
`WebBundleSafetyConfig`, `ReactResolutionResult`, `NativeImportCheckResult`, …).

### What each check looks for

**Routing conflicts** — Expo Router's route groups (`(user)`, `(admin)`) do not
affect the URL, so `app/(user)/settings/index.tsx` and
`app/(admin)/settings/index.tsx` both resolve to `/settings`. Reports multiple
files resolving to one URL, and a static route colliding with a dynamic route at
the same depth. Single-line `export { default } from …` re-exports are treated as
intentional duplicates and excluded; a redirect-only file is **not** excluded,
because a `<Redirect>` sharing a URL with a real screen silently shadows it.
Missing `_layout.tsx` directories are reported separately in `missingLayouts`.

**Web bundle safety** — Metro serves web bundles as plain `<script>`, so
`import.meta` is undefined and Zustand v5's `import.meta.env.MODE` crashes the
bundle. Checks that every Zustand store has a `.web.ts` counterpart, that the
counterpart does not itself import Zustand, that its exported names cover the
native file's, that native-only providers have `.web.tsx` counterparts, and that
no `.web.*` file uses `import.meta`. Defaults are Supa-shaped and configurable:
`storesDir: "stores"`, `providersDir: "providers"`, `additionalWebDirs:
["components"]`, `nativeOnlyPatterns: [/useConvexConnectionState/]` — that last
one decides which providers count as native-only, so override it for your app.

**React resolution** — resolves `react` from the app directory and from each
native package's own directory (`react-native`, `expo-modules-core`,
`react-native-web` by default, via `reactNativePackages`) and requires them all to
be the same **version**; also scans the pnpm virtual store for distinct `react@*`
entries and checks `react`/`react-dom` agree on major.minor. A native package
keyed to a second React re-keys the Expo native-module graph and breaks Fabric
registration on the installed binary — native video and animated GIFs render blank
while typecheck, tests, and the JS bundle all pass. Comparing versions rather than
paths is what makes it correct under both pnpm linkers: under
`node-linker=hoisted` one React is hard-linked to several paths and there is no
app-local copy at all.

**Native imports** — reads `native-deps.json` (`{ "core": [...], "gated": [...] }`),
reports static imports of `gated` packages with file and line, and reports native
dependencies in `package.json` that are in neither list.

## Constraints worth knowing

> **⚠️ `checkNativeImports` matches gated specifiers exactly; the
> `@supa-media/native-safety` CLI also resolves subpaths.** `import … from
> "expo-av/build/Video"` is caught by `check-native-imports`, and is **not**
> caught here. Where both are available, the CLI is the stricter gate.

> **⚠️ `checkNativeImports` throws if `native-deps.json` is missing** — not
> returns empty. So `createSupaTests(...).nativeImports` fails hard until the file
> exists, which is intentional but surprising the first time.

> **⚠️ React resolution reads the real `node_modules`.** Run it after
> `pnpm install`, never against a stale or partial install, or it reports on a
> layout that does not exist.

> **⚠️ `testRoutingConflicts` throws on `missingLayouts` as well as conflicts.**
> If nested stacks in your app legitimately share a parent layout, call
> `detectRoutingConflicts` and assert on `conflicts` yourself.

`ResolvedReactInfo`, `NativePackageReact`, and `ReactResolutionOptions` are
declared in the react-resolution module but are not among the type re-exports on
the package root, even though `ReactResolutionResult` references
`NativePackageReact`. Import positions and shapes accordingly.

## In CI

The framework's reusable `ci.yml` runs whatever `mobile-test-command` you pass,
after a frozen-lockfile install:

```yaml
    uses: Supa-Media/supa-framework/.github/workflows/ci.yml@v1
    with:
      mobile-test-command: pnpm test
```

which reaches these checks through the template's Jest config —
`{ testEnvironment: "node", testMatch: ["**/__tests__/**/*.test.js"] }`. The
`node` environment matters: these are file-system checks, not component tests, and
jsdom buys nothing.

## Test coverage of this package

Honest state: `node --test` here runs **one** suite, `__tests__/react-resolution.test.js`,
with three cases — a healthy hoisted install, a healthy isolated install, and a
dual-React install where `expo-modules-core` is keyed to a second React. Those
build real `node_modules` fixtures on disk, so they are meaningful, and they exist
because the guard's earlier design failed healthy hoisted installs.

The routing-conflict, web-bundle-safety, and native-import checks have **no tests
in this package**. They are regex- and filesystem-heuristic based; read the
behaviour above as a description of intent, and verify against your own app before
you rely on a green result.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework.
MIT licensed.
