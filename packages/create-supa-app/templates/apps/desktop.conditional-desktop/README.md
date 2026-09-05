# {{APP_NAME}} — desktop

A macOS menu-bar app built on
[`@supa-media/desktop`](https://github.com/Supa-Media/supa-framework/tree/main/packages/desktop).

```sh
pnpm --filter @{{APP_SLUG}}/desktop build     # esbuild → dist/
pnpm --filter @{{APP_SLUG}}/desktop start     # electron dist/main/index.js
pnpm --filter @{{APP_SLUG}}/desktop dev       # rebuild on change; start in another shell
pnpm --filter @{{APP_SLUG}}/desktop test      # offline; no Electron needed
```

## Where the pieces are

```
src/core/      no Electron anywhere in it — this is what CI tests
  settings.js    what the app remembers, and how a broken file is repaired
  tray.js        what the menu bar says, as a pure function
src/shared/    the bridge declaration, imported by both sides
src/main/      Electron: tray, panel, store, wiring
src/preload/   the frozen object a window gets on `window.desktop`
src/renderer/  the panel — renders pushed state, sends verbs, decides nothing
test/          offline, no Electron, no network
```

**The split is the point.** `src/core` never imports `electron`, which is why
`pnpm test` runs in under a second with Electron not installed — and
`check-core-isolation` (the first half of the `test` script) is what keeps that
true rather than hoping. When you add a rule, add it to `core/` with a check
beside it; when you add an Electron call, it goes in `main/`.

`src/shared` is deliberately **not** in the checked set: the bridge declaration
is shared between the preload and the main process, both of which are Electron
contexts. Nothing a test imports reaches it. If you put something in `shared/`
that the renderer or a test needs, it belongs in `core/` instead.

## Adding things

- **Persisted state** → a new field in `core/settings.js`. The store in
  `main/index.js` needs no change.
- **A new menu-bar state** → `core/tray.js`. If it opens a microphone, a camera
  or the screen, mark it `capturing: true` and the always-on indicator follows.
- **Something a window can ask for** → a command in `src/shared/bridge.js` and a
  handler in `main/index.js`. `bridge.handle` refuses to start with a command
  that has no handler, so a button that silently does nothing is a launch error.
- **Sending anything to a server** → `defineOutbox` + `drainOnce`, and put the
  credential in `safeStorageTokenStore` (the OS keychain), never in
  `settings.json`. See the package README.
- **TypeScript** → `buildDesktop` takes `.ts` entry points; point the entries at
  them and add a `tsconfig.json`. The template is JavaScript so that the tests
  need no build step at all.

## Not done here

Packaging, code signing, notarisation and auto-update. A menu-bar app that
captures anything needs a signed, notarised build with the right entitlements
before macOS will grant it the permissions it asks for, and that is a release
pipeline rather than a source file.
