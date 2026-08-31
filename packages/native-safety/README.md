# @supa-media/native-safety

**Three CI binaries that stop an over-the-air update from breaking an app that is
already installed on someone's phone.** For Expo / React Native apps that ship JS
via `expo-updates` / EAS Update, in a pnpm workspace.

## Why this exists

An OTA update ships **new JavaScript to an old native binary**. The JS bundle is
replaced; the compiled native code is not. Everything this package checks is a
way for that split to go wrong — and all of it is invisible to `tsc`, to unit
tests, and to a successful bundle, because tests mock native modules and Metro
does not care whether a native module is actually present on the device.

| Failure | What the user sees | Guard |
| --- | --- | --- |
| The JS statically imports a native module the installed binary doesn't contain | Crash on the screen that imports it | `check-native-imports` |
| Native code changed since the last build, but an OTA is pushed anyway | Same, app-wide | `check-fingerprint` |
| A second React re-keys the Expo native-module graph | Native video and animated GIFs render blank; Fabric view/module registration is broken | `check-react-consistency` (gates 1 & 2) |
| `react-dom` peer-keyed to a different `react` | Anything that server-renders throws in production (SSR, react-email in a server function) | `check-react-consistency` (gate 3) |

The React gates are ported from Togather's postmortem of PR #548, where adding
`@mui/*` + `@emotion/*` for a **web-only** datepicker made pnpm's
`autoInstallPeers` pull a second React into the shared lockfile, re-keyed
`expo-modules-core`, and blanked native video on device — with CI fully green.

## Install

```
pnpm add -D @supa-media/native-safety
```

Peer dependency, only needed for `check-fingerprint`:

```
pnpm add -D @expo/fingerprint
```

It is declared optional, so the other two binaries work without it;
`check-fingerprint` exits **2** with an install hint if it is missing.

## `check-fingerprint`

Hashes all native-affecting inputs with `@expo/fingerprint` and compares against
a committed baseline file. Run it before publishing an OTA.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--project-dir <path>` | `.` | Expo project directory to fingerprint |
| `--fingerprint-file <path>` | `.fingerprint` | Baseline file, resolved **relative to `--project-dir`** |
| `--update` | off | Write the current hash to the baseline and exit 0 |
| `--help`, `-h` | — | Usage |

Exit codes are three-valued, not the usual two:

| Code | Meaning |
| --- | --- |
| `0` | Hash matches the baseline (or `--update` was used) — OTA is safe |
| `1` | Native code changed — **a new native build is required, do not OTA** |
| `2` | Could not run the check: `@expo/fingerprint` missing, fingerprint threw, or no baseline file exists |

> **⚠️ Exit 2 is not a pass.** A missing `.fingerprint` file exits 2, and a
> naive `|| true` or an unchecked step turns "we never checked" into a green
> build. Treat 1 and 2 alike in CI.

Workflow: after every native build, run `check-fingerprint --update` and **commit
the baseline**. It is the record of what the installed binary actually contains.

## `check-native-imports`

Scans your source for **static** imports of dependencies you classified as
`gated`, and optionally verifies every native dependency in `package.json` has
been classified at all.

| Flag | Required | Meaning |
| --- | --- | --- |
| `--config <path>` | yes | Path to `native-deps.json` |
| `--src <path>` | yes | Directory to scan recursively |
| `--allowlist <a,b,c>` | no | Comma-separated files permitted to statically import gated deps, **relative to `--src`** — these are your gating wrappers |
| `--check-package-json` | no | Also fail on native deps in `package.json` that appear in neither `core` nor `gated` |
| `--help`, `-h` | — | Usage |

Exits `1` on any violation or bad input, `0` otherwise.

What counts as a static import is deliberately narrow: `import … from 'pkg'`,
bare `import 'pkg'`, `export … from 'pkg'`. A `require('pkg')` or dynamic
`import('pkg')` is **not** flagged — that is the escape hatch gating relies on.
Subpaths resolve to their base package (`expo-av/build/Video` counts as
`expo-av`). The scan covers `.ts/.tsx/.js/.jsx`, skipping `.d.ts`, dot-directories,
`node_modules`, `dist`, `build`, `web-build`, `.expo`, `.next`.

The pattern the check exists to enforce:

```ts
import { hasNativeModule } from '@supa-media/native-safety/src/hasNativeModule';

export function isLinearGradientSupported(): boolean {
  if (!hasNativeModule('ExpoLinearGradient')) return false;
  try {
    return !!require('expo-linear-gradient')?.LinearGradient;
  } catch {
    return false;
  }
}
```

`hasNativeModule(...names)` returns true if **any** name is registered: it checks
the legacy `NativeModules` bridge first, then `expo-modules-core`'s
`requireNativeModule` for the new architecture, and returns `false` immediately on
web. It takes several names because a module can register under different ones on
the two architectures (`ExpoAV` vs `ExponentAV`).

> **⚠️ `hasNativeModule` is not re-exported from the package's JS entry point.**
> `main` (`src/index.js`) exports only the pattern constants; the function lives
> in `src/hasNativeModule.ts` and only the **type** declarations re-export it. A
> plain `import { hasNativeModule } from '@supa-media/native-safety'` typechecks
> and is `undefined` at runtime. Import the source path, as above — Metro
> compiles the TS.

## `check-react-consistency`

Three independent gates over `pnpm-lock.yaml` and one `package.json`. **All three
run every time** (no short-circuit, so one pass reports every failure); the
process exits `1` if any fails and prints a combined OK line only if all pass.

| Flag | Required | Meaning |
| --- | --- | --- |
| `--pkg <path>` | yes | The app's `package.json`. Its `dependencies.react` is the pinned version gate 1 asserts against |
| `--lockfile <path>` | yes | The workspace-root `pnpm-lock.yaml` |
| `--config <path>` | no | A `native-deps.json`, used for gate 1's scoped-package detection and gate 2's denylist extension |
| `--denylist <a,b/>` | no | Comma-separated extra package names/prefixes for gate 2 |

**Gate 1 — single React in the native graph.** Walks every lockfile package key,
keeps the ones that look native (`expo`, `expo-*`, `@expo/*`, `react-native`,
`react-native-*`, `@react-native/*`, plus any name listed in `--config`'s `core`
or `gated`), and extracts the `(react@X)` peer keyed onto each. That set must be
exactly `{dependencies.react}`. `react-native-web` is excluded on purpose: it is
the browser render shim, does not run on the native binary, and legitimately
rides a different web React. `(@types/react@X)` is not mistaken for a real React
peer. Throws (→ exit 1) if `--pkg` has no `dependencies.react`.

**Gate 2 — native-unsafe dependency denylist.** Fails if `--pkg`'s `dependencies`
or `devDependencies` contain any package matching the denylist. The default list
is `@mui/`, `@emotion/`, `@material-ui/`, `styled-components` — emotion /
CSS-in-JS / MUI-family libraries that pull their own React via `autoInstallPeers`
and reshape the module graph **even when imported only on web**. This is gate 1's
cause, caught one step earlier and with a name attached. An entry ending in `/`
matches by prefix; otherwise it matches the exact name or a prefix of it. Extend
per-app via `--denylist` or `nativeUnsafeDenylist` in `native-deps.json` — do not
edit the default.

**Gate 3 — `react-dom` / `react` exact pairing.** Every `react-dom` entry in the
lockfile must be keyed to its own exact react version; `react-dom@19.2.4(react@19.1.0)`
fails. This gate is **lockfile-wide and independent of the app's pin** — a
workspace may legitimately run mobile on 19.1.0 and web on 19.2.4, as long as each
`react-dom` matches the react beside it. The skew itself is the hazard: React ≥ 19.2's
`ensureCorrectIsomorphicReactVersion` hard-errors in `react-dom`'s server
renderer, but only when something actually renders, so typecheck, bundling and
non-rendering tests stay green. Togather shipped exactly this — a pinned `react`
with `react-dom` left to auto-install as a transitive peer — and production
verification emails threw with CI green. Entries with no react peer, or keyed only
to `@types/react`, are ignored.

> **⚠️ Gate 1 only parses pnpm v6-style package keys** (`  /pkg@1.0.0(react@X):`,
> leading slash). It was ported unchanged from the script that caught the original
> regression. On a **pnpm v9+ lockfile**, whose `snapshots:` keys have no leading
> slash, gate 1 matches nothing and passes vacuously. Gate 3 handles both key
> shapes deliberately, because it makes a lockfile-wide claim. If you are on v9,
> do not read gate 1's green line as proof of anything until this is fixed
> upstream.

> **⚠️ A `--config` path that is passed but missing or unparseable is a hard
> failure**, by design: silently degrading to "no config" would disable
> scoped-package detection and the denylist extension while still printing a green
> banner. Omitting `--config` entirely is the permissive path.

> **⚠️ Not covered:** two peer-keyed **instances** of `react-native`/`expo-*` on
> the *same* React version also split the Fabric registry, and gate 1 — which
> compares versions — passes on it. As of 1.2.0 that gate lives only in
> Togather's local `check-native-instance.js`.

## `native-deps.json`

The classification file. Ships as `native-deps.example.json` inside the package
for reference.

| Key | Type | Used by | Meaning |
| --- | --- | --- | --- |
| `core` | `string[]` | both CLIs | Present in the baseline native build — safe to import statically |
| `gated` | `string[]` | both CLIs | **Not** guaranteed to be in the installed binary — must be imported dynamically behind a runtime check |
| `nativeUnsafeDenylist` | `string[]` | `check-react-consistency` gate 2 | App-specific additions to the web-lib denylist |
| `$comment` | `string` | — | Ignored; a place to leave the reason |

```json
{
  "core": ["react-native", "expo", "expo-router", "expo-file-system"],
  "gated": ["expo-linear-gradient", "expo-av", "expo-video", "expo-audio"],
  "nativeUnsafeDenylist": ["antd"]
}
```

Anything in `dependencies` matching the native-package heuristic (`react-native*`,
`expo*`, `@expo/*`, `@react-native*`, `@sentry/react-native`, `@shopify/flash-list`,
`@gorhom/bottom-sheet`, `@rnmapbox/*`, `@mapbox/*`) must land in one list or the
other. `--check-package-json` enforces that, and inspects `dependencies` only —
not `devDependencies`.

> **⚠️ An empty `gated` array makes `check-native-imports` a no-op.** It prints
> "No gated dependencies defined" and exits 0 without scanning a single file. A
> template that starts with `"gated": []` is not being protected yet.

## In CI

Togather's `apps/mobile` job, verbatim:

```yaml
      - name: Check native fingerprint
        working-directory: apps/mobile
        run: node scripts/check-fingerprint.js

      - name: Check native import gating
        working-directory: apps/mobile
        run: node scripts/check-native-imports.js

      - name: Check React consistency (single React in native graph)
        working-directory: apps/mobile
        run: npx check-react-consistency --pkg package.json --lockfile ../../pnpm-lock.yaml --config native-deps.json
```

Note the paths: `--pkg` is the app's manifest, `--lockfile` is the **workspace
root's** lockfile two levels up. Run every check after `pnpm install
--frozen-lockfile`, since all three read the installed/locked state.

The two other binaries, when installed rather than vendored:

```yaml
      - name: Check native import gating
        working-directory: apps/mobile
        run: >-
          npx check-native-imports --config native-deps.json --src . --check-package-json
          --allowlist features/chat/utils/fileTypes.ts,components/ui/SafeLinearGradient.tsx
```

Run `check-fingerprint` again in the OTA deploy workflow, not only on PRs — it is
the last gate before the bundle reaches devices.

## Programmatic use

`main` (`src/index.js`) exports the detection primitives shared with the CLIs:
`NATIVE_PACKAGE_PATTERNS`, `STATIC_IMPORT_REGEX`, `SKIP_DIRS`,
`SOURCE_EXTENSIONS`, `EXCLUDE_FILE_PATTERNS`, `isNativePackage(name)`. The type
declarations additionally surface `hasNativeModule` (see the caveat above).

`src/check-react-consistency.js` also exports its gate functions
(`checkReactConsistency`, `checkReactDomPairing`, `checkNativeUnsafeDenylist`,
`loadConfig`, `packageNameFromKey`, `DEFAULT_NATIVE_UNSAFE_DENYLIST`). They never
call `process.exit` — they return `true`/`false` or throw, leaving exit codes to
the CLI. The package's own tests consume them that way, but they are reachable
only by deep path and are not a declared entry point.

## Testing

`node --test` runs 22 tests: real `package.json` / `pnpm-lock.yaml` fixtures on
disk for each gate (healthy, dual-React, scoped-native-via-config, skewed
`react-dom`, v9 snapshot keys), plus subprocess spawns of the CLI pinning its exit
codes and its refusal to print the success banner on a bad `--config`.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework.
MIT licensed.
