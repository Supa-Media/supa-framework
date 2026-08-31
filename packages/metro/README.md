# @supa-media/metro

**Metro config for an Expo app that lives inside a pnpm workspace.** One factory
that returns a ready config with the pnpm-specific resolver settings already
correct, so `metro.config.js` stays two lines instead of forty.

## Install

```bash
pnpm add -D @supa-media/metro
```

Peer dependency: `@expo/metro-config` — already present in every Expo app (the
factory loads it through `expo/metro-config`). `nativewind` and
`@sentry/react-native` are only needed if you opt into `withNativeWind` /
`withSentry`; both are `require`d lazily and fall back with a warning if absent.

## Usage

```js
// apps/mobile/metro.config.js
const { createMetroConfig } = require("@supa-media/metro");

module.exports = createMetroConfig({
  projectRoot: __dirname,
  sharedPackages: ["@myapp/shared"],
});
```

## Options

| Option | Type | What it does |
| --- | --- | --- |
| `projectRoot` | `string` (required) | Absolute path to the app directory — pass `__dirname`. The workspace root is found by walking up from here for a `pnpm-workspace.yaml` or a `package.json` with `workspaces` (falling back to `../..`). |
| `sharedPackages` | `string[]` | Workspace package names to resolve **from source**, e.g. `["@myapp/shared"]`. |
| `withNativeWind` | `boolean` | Wraps the result with `nativewind/metro`, hardcoded to `{ input: "./global.css" }`. |
| `withSentry` | `boolean` | Uses `getSentryExpoConfig` as the base config instead of Expo's `getDefaultConfig`, for Debug ID injection. |
| `extend` | `(config) => config` | Escape hatch, applied **after** the resolver setup and **before** NativeWind wrapping. |

## What it actually sets

- `resolver.unstable_enableSymlinks: true` and `resolver.disableHierarchicalLookup: true` —
  pnpm links every dependency, and without these Metro either refuses to follow
  the symlink or walks up out of the linked package into the wrong `node_modules`.
- `resolver.nodeModulesPaths: [<projectRoot>/node_modules, <workspaceRoot>/node_modules]`, in that order.
- `watchFolders`: Expo's defaults plus the workspace root, each resolved shared
  package directory, and `<workspaceRoot>/node_modules/.pnpm` — the store is where
  the real files behind the symlinks live, so without it Metro watches links and
  misses edits. Non-existent paths are filtered out.
- `resolver.extraNodeModules[pkg]` → the shared package's `src/` if it exists, else its root.
- `resolver.resolveRequest`: shared-package resolution first, then any
  `resolveRequest` the base config already had, then Metro's default.

For a shared package, imports of `@myapp/shared` and `@myapp/shared/<subpath>`
resolve through the target package's `exports` map, falling back to
`src/<subpath>` (or `src/index.ts`), and are returned as
`{ type: "sourceFile" }` — Metro compiles the TypeScript directly rather than a
build output that may not exist during development.

> **⚠️ Shared packages are located by convention, not by node resolution.**
> The scope is stripped from the name and the result is looked up at
> `<workspaceRoot>/packages/<name>` — `@myapp/shared` must live at
> `packages/shared`. A package anywhere else is silently ignored: it drops out of
> `watchFolders`, `extraNodeModules`, and the custom resolver, and you fall back
> to whatever plain Metro resolution does.

No tests ship with this package.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework. MIT.
