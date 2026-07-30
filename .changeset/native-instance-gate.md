---
"@supa-media/native-safety": minor
---

`check-react-consistency` gains a fourth gate: **single native instance**. Every
*shared* native package in the lockfile must resolve the same `react-native` /
`expo` instance the app importer resolves.

This closes gate #1's blind spot. Gate #1 asks "is there a second React version
keyed onto native packages?" — but a lockfile can hold two peer-keyed instances
of `react-native` at the **same** React version:

```
react-native@0.81.5(@babel/core@7.29.0)(@types/react@19.1.17)(react@19.1.0)   <- the app's
react-native@0.81.5(@babel/core@7.29.0)(react@19.1.0)                         <- e.g. a workspace-root dep's
```

Both are `(react@19.1.0)`, so the React-version set is a clean `{pinned}` and
gate #1 passes. What actually matters is **which instance the Expo native chain
points at**. When a re-resolution flips `expo-modules-core` & friends onto the
other one, pnpm materialises two physical copies in one bundle, so
expo-modules-core registers Fabric views into its copy's registry while the app's
components look them up in the other. `requireNativeViewManager(...)` returns
undefined → `ViewManagerAdapter_… must be a function (received undefined)` →
native video falls back or renders blank and animated GIFs break, while static
images (which need no native view) keep working. Typecheck, jest, and bundling
all stay green.

Togather shipped this twice. The second time (2026-07) a dependency bump for an
unrelated package — `@supa-media/dev-assistant` — re-resolved the workspace and
re-keyed nine Expo blocks (`expo-modules-core`, `expo-asset`, `expo-constants`,
`expo-file-system`, `expo-font`, `expo-keep-awake`, `@expo/devtools`,
`@expo/metro-config`, `@expo/prebuild-config`), 13 dependency references in
total. Every existing guard passed. This is the hazard Togather's CLAUDE.md
already described in prose — "a bare workspace-root `pnpm install` can
non-deterministically re-key expo/expo-modules-core/react-native" — now
mechanically enforced.

Only **shared** packages (exactly one copy in the lockfile) are checked. A
multi-copy package has one copy per instance family, and each correctly points at
its own family's runtime — the workspace root's own `expo`, its
`@react-native/virtualized-lists`, a build-time second `@expo/cli`. Demanding
those match the app would fire on a healthy graph, and a gate that fires on a
healthy graph is a gate someone switches off. A single-copy package, by contrast,
is shared by everything and can only register into one registry — which had
better be the app's. Verified against Togather's real lockfiles in three
directions: it passes their known-good baseline, passes the fix, and fails the
broken tree with exactly the 13 references.

New `--importer <path>` names the app's key in the lockfile's `importers:` map
(default: `--pkg`'s directory relative to the lockfile's). It **fails closed** —
an importer that isn't in the lockfile is an error, not a skip. A lockfile with no
`importers:` block at all (a non-workspace project) is reported as genuinely n/a.
