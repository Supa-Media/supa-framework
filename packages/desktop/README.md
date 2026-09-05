# @supa-media/desktop

**The Electron shell a Supa app would otherwise write from scratch: a menu-bar
tray, panel and app windows, a preload bridge, a repairing settings store, an
offline outbox, and a credential that lives in the OS keychain.**

Extracted from a shipped menu-bar app. Everything that *decides* is a pure
function under `@supa-media/desktop`; everything that *does* is a thin wrapper
under `@supa-media/desktop/electron`. That split is the package's main claim:
the core runs under plain `node --test` in under half a second, with Electron
not installed, and a `check-core-isolation` bin keeps it that way in your app
too.

## Install

```
pnpm add @supa-media/desktop
pnpm add -D electron esbuild
```

`electron` and `esbuild` are **optional peers**. Importing
`@supa-media/desktop` (the core) needs neither. `@supa-media/desktop/electron`
needs Electron ≥ 31; `@supa-media/desktop/build` needs esbuild.

ESM only — the main process is bundled as ESM and the preload as CommonJS, and
`buildDesktop` handles both.

## The three entry points

| Import | Needs Electron | What it is |
| --- | --- | --- |
| `@supa-media/desktop` | no | settings, denylist, consent, outbox, client, drain, tray presentation, panel geometry, permission ordering |
| `@supa-media/desktop/electron` | yes | windows, tray, bridge, JSON store, `safeStorage` token store, permission broker |
| `@supa-media/desktop/build` | no (esbuild) | the one esbuild pass over main / preload / renderer |

Plus one bin, `check-core-isolation`, described at the bottom.

## What you get, and the failure each piece is about

### The tray, and the invariant that cannot be written wrong

```js
import { defineTray, formatElapsed } from "@supa-media/desktop";

export const tray = defineTray({
  states: {
    idle:      { icon: "idle",      tooltip: () => "Not watching" },
    recording: { icon: "recording", capturing: true,
                 title: (i) => formatElapsed(i.elapsedMs),
                 tooltip: (i) => `Recording ${i.title}` },
  },
  suffix: (i) => (i.pending ? ` · ${i.pending} waiting to save` : ""),
});
```

A state declares `capturing` and **cannot** declare `indicator` —
`defineTray` throws if it tries. The always-on indicator is derived, so "a
capturing state with no indicator" is not a bug you can write, rather than a bug
a test has to catch. For a menu-bar app whose states include "a microphone is
open right now", that is a privacy control rather than a styling detail.

Every word is yours. This package owns the invariant, not the copy.

### Panel positioning

`positionUnderTray(panel, trayBounds)` centres the panel under the icon, on the
display the icon is actually on, clamped so it cannot run off either edge, and
flipped *above* the icon for a bottom-edge taskbar. The arithmetic is
`panelPositionUnderTray` in the core, which is why the edge cases — the icon at
the far right of a cluttered menu bar, the second monitor, the 300pt-wide
display — are tested rather than discovered on somebody else's machine.

`createAppWindow` gives you close-to-hide (call `markQuitting()` from
`before-quit` or the app will not exit) and `revealQuietly` shows a window
**without taking focus**, which is the whole difference between an app people
keep and an app that steals focus mid-sentence.

Windows are created with `contextIsolation: true`, `nodeIntegration: false` and
`sandbox: true`. The sandbox is stricter than Electron's own default; a bundled
preload that talks only to `electron` is unaffected. `unsafeAllowNodeInPreload`
is the escape hatch, named to be visible in a diff.

### The preload bridge

```js
// shared/bridge.js — imported by both the preload and the main process
export const bridge = defineBridge({
  name: "app",
  channels: ["state"],
  commands: ["accept", "decline", "end", "setPreference"],
});

// preload/index.js
bridge.expose();                       // window.app, frozen

// main/index.js
bridge.handle({ accept: …, decline: …, end: …, setPreference: … });
bridge.push([panel, window], "state", uiState());
```

There is deliberately **no request/response direction**. A command is
fire-and-forget and the answer arrives as the next pushed state, which is how
"there is no `getToken`" stays true without anybody having to remember it. A
preload exposing `invoke(channel, …args)` has handed the renderer the whole main
process behind one function, and the audit that would have caught it is now a
search for every call site rather than a read of one declaration.

`handle` throws for a declared command with no handler *and* for a handler with
no declared command, so a button that silently does nothing is a startup error.

### Settings that never widen permission

```js
const settings = defineSettings({
  version: 1,
  fields: {
    captureEnabled: boolField(false),
    askEveryTime:   boolField(true),
    denylist:       stringListField({ sticky: true }),
    endpoint:       endpointField(),
  },
});
```

`normalize` never throws and repairs anything — a missing file, a truncated one,
a hand edit, a record from a newer build — onto the *safe* value for every field
it cannot read. Two specifics worth knowing:

- `boolField` takes a fallback rather than coercing. `Boolean(undefined)` is
  `false`, and `false` for "ask every time" is an app that acts without asking;
  `"no"` is a truthy string, so coercion reads a person's plain-English refusal
  as consent.
- `sticky: true` fields are read *before* the version check, so a record from a
  build you do not understand still carries them. That is the right direction
  for exactly one class of field — a list of things the app was told never to do.

`endpointField` accepts https, refuses credentials in the URL outright, and
allows plain http only for loopback, so self-hosting works and a coffee-shop
network does not.

### The denylist

`isDenied`, `isDeniedApp`, `isDeniedUrl`, `withoutDenied`. One typed word
matches every shape the same app arrives under — `Zoom`, `zoom.us`,
`us.zoom.xos`, `/Applications/zoom.us.app`, a `zoom.us` tab — and it is
**segment equality, never a substring**, so `zoom` does not deny `Zoombini` and
`meet` does not deny `Meetup`. A host matches by label, by suffix and in full,
but never by its TLD.

Honour it twice: `withoutDenied` before observation (so a denied thing's window
title never reaches a log line, a tooltip or a crash report) and `isDenied` at
the consent gate (so something that arrived another way still cannot start a
capture). The first keeps it out of the interface; the second keeps it out of
the microphone.

### The consent gate

```js
const action = decideConsent({
  episode: episodeKey(activation),  // your watcher's activation
  consent,                           // one episode, one decision, no history
  denied: isDenied(subject, settings.denylist),
  captureEnabled: settings.captureEnabled,
  askEveryTime: settings.askEveryTime,
  busy: controller.capturing,
});
// { kind: "ask" | "start" } | { kind: "hold", why: HoldReason }
```

Nothing captures without a yes; a no is sticky **for that episode**, so a
watcher polling every five seconds does not turn "Not now" into "ask me again
forever"; and the denylist beats an explicit yes, checked first so the reason a
person reads is the one they configured.

This module decides *whether*. Your app decides what an episode **is** —
`episodeKey({ active, since, source })` composes the shape that gets both hard
cases right (two calls in one app are two episodes; fifty polls of one call are
one episode), but the activation is yours.

### The offline outbox

```js
const outbox = defineOutbox({
  kinds: ["create", "chunks", "notes", "finish"],
  merge: { chunks: mergeById("id", "chunks", (a, b) => a.at - b.at) },
});

queue = outbox.queue(queue, { subjectId, kind: "notes", body, now: Date.now() });
const report = await drainOnce(queue, outbox, { baseUrl, route, token }, Date.now);
```

A **subject** is the thing writes are about; a **kind** is which write. The
rules the reducer holds:

- **Nothing is dropped to save space.** No cap, no LRU, no compaction. An entry
  leaves by being acknowledged or by a person deleting its subject.
- **One entry per subject per kind, newest wins** — an hour of typing is one
  request. Kinds that genuinely accumulate declare a `merge` and are keyed on a
  stable id, so a replay after a reconnect collapses rather than duplicating.
- **Declared order, head-of-subject only.** A `finish` cannot overtake the
  content it is finishing. Different subjects never block each other.
- **A refusal nothing can fix parks rather than deletes.** The content survives;
  a person has to reconnect or re-grant. A parked head blocks its own subject
  and nothing else.

`postEntry` puts the credential in a header and provably nowhere else, and
treats a **captive portal's non-JSON `200` as retryable rather than as an
acknowledgement** — the entry is deleted on `ok`, so counting a login page as a
successful write empties the queue into nothing.

### The credential

`safeStorageTokenStore({ file })` encrypts with the OS key — Keychain, DPAPI,
libsecret — and **refuses to store anything when the OS offers no encrypted
storage** rather than falling back to a `0600` file. `encrypted` is false there,
and "this machine has no secure storage, so it stays disconnected" is the honest
state to show. `memoryTokenStore` is for tests and `--dev`.

Nothing here is reachable through `defineBridge`. The renderer asks the main
process to send; the main process attaches the header.

### The build

```js
// apps/desktop/scripts/build.mjs
import { buildDesktop } from "@supa-media/desktop/build";

await buildDesktop({
  root: new URL("..", import.meta.url).pathname,
  main: "src/main/index.ts",
  preloads: { "preload.js": "src/preload/index.ts" },
  renderers: { "panel.js": "src/renderer/panel.ts" },
  static: ["src/renderer/panel.html", "src/renderer/panel.css"],
  watch: process.argv.includes("--watch"),
});
```

Three worlds, three settings, and one of them is a trap: **preloads are bundled
as CommonJS**, because Electron `require`s them and an ESM preload silently does
nothing — the window loads, looks right, and has no `window.app` on it, so it
presents as a renderer bug. `main` is ESM with `electron` external; renderers are
browser ESM. HTML and CSS are copied, not processed.

`DEFAULT_TARGETS` is `node20` / `chrome128`, pinned to Electron 33. Move both
together when you move Electron majors.

## `check-core-isolation`

```
npx check-core-isolation src/core
npx check-core-isolation src/core src/shared --also electron-store
```

Reports every import of `electron` (static, dynamic, `require`, and type-only)
in the directories you name, with file and line, and exits non-zero. It is a
text scan — no `node_modules`, no resolver, no build — because a guard that only
runs after a successful install is skipped exactly when a broken install is what
somebody is debugging.

Put it in your desktop app's `test` script. In *this* package an Electron import
in `src/core` takes the whole suite down before a check runs, which is loud; in
your app Electron is installed, so the same import resolves happily and nothing
fails until CI tries to run the core suite without it. That silent case is what
the bin is for.

## What this package deliberately does not do

It is a shell, not an application. It has no opinion about, and ships no code
for:

- **detecting anything** — no watcher, no collectors, no polling loop, no
  hysteresis. `episodeKey` takes an activation you produced.
- **capturing anything** — no audio, no screen, no camera, no `MediaRecorder`,
  no `desktopCapturer`. `createHiddenWindow` gives you the browser context a
  capture needs and stops there.
- **transcribing, summarising or enhancing** anything.
- **a design system** — no CSS, no components, no icon art. `svgImage` carries
  one fact (a recording mark must *not* be a template image, or it inverts with
  the menu bar and nobody sees it) and leaves the drawing to you.
- **auto-update, packaging, signing or notarisation.** Those are a build
  pipeline, not a module.

### Where the boundary was genuinely arguable

**The consent gate is here; the thing it gates is not.** The subject matter of
the app it came from was meeting-specific, but the shape is not: *ask before a
privileged capture, remember the refusal for the episode, honour a denylist
first*. It is forty lines, it parameterises cleanly onto five booleans and a
string, and the same three rules apply to a screen recorder, a clipboard
watcher or a location logger. What stayed behind is everything that decides
*when* to ask — which is the part that is always domain knowledge.

**The permission broker is here** even though "asking macOS for the microphone"
sounds application-specific. What is generic is the *ordering*: ask only for
`not-determined`, never re-ask `denied` (macOS ignores it and the app looks
frozen), ask one at a time (two dialogs race and stack), and open the right
Settings pane for a refusal. The rationale strings — the sentences a person
reads — stay in your app, because they describe what *you* capture.

**Recording controllers, media pipelines and anything that names a document
kind stayed behind.** A half-generic "session controller" that every app has to
fight is worse than no controller at all.

## Testing your own app

The core split exists so your app's logic tests the same way this package does:

```json
{
  "scripts": {
    "test": "check-core-isolation src/core && node --test \"test/*.test.js\"",
    "build": "node scripts/build.mjs"
  }
}
```

No Electron, no network, no build step between the test and the code it checks.
This package's own suite is **96 checks** on that footing, and every file
carries a *sabotage record*: the invariant was broken deliberately, the run was
watched, and the number of failures is written down — including the one place
where the sabotage produced **zero** failures and the guard is recorded as
untested rather than left looking covered.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework.
MIT licensed.
