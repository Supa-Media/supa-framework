# @supa-media/apple-targets

**The `app.config.js` changes, `expo-target.config.js` shapes and phone↔watch
transport rules for adding a watchOS app or a Live Activity to a Supa Expo app.**

Not a config plugin and not a native module. `@bacons/apple-targets` generates
the targets; `expo-widgets` renders Live Activities as React components. This
package is the layer above both: the App Group that has to be the same string in
three places, the team id that must not be committed to a public repository, and
the delivery rules that decide whether a button on somebody's wrist starts a
recording they did not ask for.

Everything here is a pure function, tested with `node --test`, with no Expo, no
Xcode and no device.

## Install

```
pnpm add @supa-media/apple-targets
pnpm add @bacons/apple-targets        # only if you are shipping a native target
```

CommonJS, because the primary consumer is `app.config.js`, which Expo loads as
CommonJS.

## Read this before you plan a watch app

**You get a real watch surface with no watchOS target at all.** Since watchOS 11
and iOS 18, a Live Activity running on a paired iPhone is mirrored into the Apple
Watch Smart Stack automatically — no watch app, no separate push token, no
watch-specific code. It covers the mid-session surface: title, elapsed time,
state.

It does **not** cover starting a session from the wrist (a Live Activity does not
exist until a session does, so there is nothing to mirror before it starts) and
it does not put anything on the watch face.

So the staging is: **Live Activity first, watch target only for the things that
genuinely need one** — starting from the wrist, a watch-face complication, and
reliable controls when the activity is not at the top of the Smart Stack.

What a watchOS target actually costs, before you decide:

- **A second codebase, in Swift.** None of your React Native code, design
  tokens, auth session or Convex client exists on it. Everything it shows is
  pushed as data.
- **It is outside the OTA channel.** A bug in the watch UI ships with a new
  binary through the App Store, not in an afternoon.
- **A second bundle identifier and provisioning profile.** EAS resolves
  companion-target credentials by walking target dependencies; expect friction
  on the first build rather than a blocker.
- **App Store review of a second target.** A watch app that does nothing when
  the phone is absent is a rejection risk, so `presentState` below returns a
  coherent "no session" rather than an error.

## `app.config.js`

```js
const { appGroupIdentifier, withAppleTargets } = require("@supa-media/apple-targets");

const bundleId = "com.example.app";

module.exports = ({ config }) =>
  withAppleTargets(
    { ...config, name: "Example", ios: { ...config.ios, bundleIdentifier: bundleId } },
    {
      appGroup: appGroupIdentifier(bundleId),   // "group.com.example.app"
      backgroundModes: ["audio"],               // only if you capture in the background
    },
  );
```

What it does:

| Change | Why |
| --- | --- |
| `ios.entitlements["com.apple.security.application-groups"]` | Targets that can use App Groups **mirror this array from the app config**, so declaring it once is what lets the widget extension and the watch app read what the app wrote. Needed for a Live Activity whether or not a watch app ever exists — which is a reason to add it early rather than when it becomes urgent. |
| `ios.appleTeamId` | Required by `@bacons/apple-targets` for signing. |
| `ios.infoPlist.UIBackgroundModes` | A microphone usage string alone does not survive the app leaving the foreground. |
| `plugins` | Appends `@bacons/apple-targets`, idempotently, leaving an already-configured entry alone. |

It returns a **new** config and never mutates the input, so applying it twice
changes nothing the second time.

> **⚠️ The team id comes from `process.env.APPLE_TEAM_ID`, and the helper throws
> if neither it nor `ios.appleTeamId` is set.** A team id is not a credential,
> but it is an account identifier, and a Supa repository may be public.
> Keep it beside the other secrets — `APPLE_TEAM_ID=op://<Vault>/Apple/team-id`
> in `.env.example` — not in a file you commit.

## `expo-target.config.js`

```js
// targets/watch/expo-target.config.js
const { appGroupIdentifier, defineWatchTarget } = require("@supa-media/apple-targets");

module.exports = defineWatchTarget({
  appGroup: appGroupIdentifier("com.example.app"),
  name: "watch",
  displayName: "Example",
  icon: "../../assets/watch-icon.png",
});
```

`defineWatchTarget`, `defineWidgetTarget` and `defineWatchWidgetTarget` produce
the plugin's config shape with sensible frameworks and deployment targets, and
`renderTargetConfig(target, note)` renders one as a file if you are generating
it.

The App Group is written **explicitly into every target** even though the plugin
mirrors the app's array by default. Mirroring is the default and an override is
silent, so a target reading a different container than the app writes builds,
installs, runs, and produces an empty shared `UserDefaults` with no error
anywhere. One string, stated in one place, passed everywhere.

Create the target directory itself with the plugin's own scaffolder —
`npx create-target watch` — then re-run `npx expo prebuild -p ios --clean`
whenever this file or the app config changes.

## The phone↔watch transport

WatchConnectivity (`WCSession`) has three mechanisms with genuinely different
delivery semantics, and picking the wrong one is a correctness mistake, not a
performance one:

| Mechanism | Semantics | For |
| --- | --- | --- |
| `sendMessage` | immediate, needs the counterpart reachable, has a reply handler | live commands |
| `updateApplicationContext` | latest value only; a newer update replaces an undelivered older one; delivered in the background on reconnect | the state snapshot |
| `transferUserInfo` | FIFO queue, guaranteed eventual delivery, background | queued commands |

```js
const watch = defineWatchBridge({
  liveCommands: ["start", "stop", "pause", "resume"],
  queuedCommands: ["flag"],
});

watch.deliverable("stop", { reachable: false });  // { ok: false, why: "unreachable" }
watch.deliverable("flag", { reachable: false });  // { ok: true, transport: "transferUserInfo" }
watch.stampCommand("flag", { state: lastSnapshot, now: Date.now() });
watch.presentState(lastSnapshot, { now: Date.now(), reachable });
```

**The snapshot goes on `updateApplicationContext`, and "only the last update
survives" is the semantic you want** rather than a limitation — a stale elapsed
time is worth nothing next to a fresh one. Push it on state transitions and a
low-frequency tick, never per unit of content: the transport is constrained, and
on iOS the same updates count against the Live Activity's update budget.

**A live command goes on `sendMessage` and its reply carries the resulting
state**, which makes the round trip self-correcting: the phone accepts or
refuses the transition, and the watch renders what the phone now believes rather
than what it hoped. A refused command is a UI correction, not an error dialog.

**Live commands are never queued.** A `start` delivered twenty minutes late
starts a recording nobody asked for; a late `stop` ends one that already
finished. `deliverable` refuses them when unreachable, so the controls are
disabled rather than optimistic.

**A queued command is one that is still true when it lands late** — a flag is a
timestamp. The detail that is easy to get backwards:

> `stampCommand` computes `atMs` **on the watch at the moment of the press**,
> from the elapsed time in the last snapshot plus the time since — never on
> arrival at the phone. A flag stamped on delivery points at the wrong sentence,
> which is worse than no flag. It also freezes while the session is paused, so
> the flag cannot land past the end of the recording.

`presentState` is the other half: a snapshot older than `stalenessMs` (30s by
default) stops presenting its timer as live and disables the controls with it,
so an out-of-range watch shows one coherent screen rather than two unrelated
glitches. No snapshot at all is `hasSession: false`, not an error.

## What is verified, and what is not

Written down because a confident wrong answer here costs weeks.

### Verified against a primary source

- **Automatic Smart Stack mirroring from watchOS 11 / iOS 18**, using the
  Dynamic Island's compact leading and trailing views, with no watch app
  required — [Bring your Live Activity to Apple Watch, WWDC24 session 10068](https://developer.apple.com/videos/play/wwdc2024/10068/).
  The same session covers `.supplementalActivityFamilies([.small])` for a
  purpose-built watch layout, `isLuminanceReduced` for Always-On, the update
  budget, and the limited-connectivity behaviour that `presentState` mirrors.
- **App Group entitlement key and mirroring** — targets that can use App Groups
  mirror `ios.entitlements["com.apple.security.application-groups"]` from the app
  config unless a target overrides it, and the identifier must start with
  `group.` in reverse-DNS form
  ([expo-apple-targets README](https://github.com/EvanBacon/expo-apple-targets/blob/main/packages/apple-targets/README.md)).
- **`@bacons/apple-targets` supports `watch`, `watch-widget` and `widget`
  types**, is created with `npx create-target <type>`, keeps target source in
  `targets/` outside the generated `ios/`, and requires Expo SDK 53+, Xcode 16,
  CocoaPods 1.16.2, macOS 15 and `ios.appleTeamId` (same source). Its README also
  says plainly that it has not tested every type in that list.
- **`ios.infoPlist.UIBackgroundModes: ["audio"]` is the Expo config location**
  for background audio, and an app must be in the foreground to *start*
  recording even with it set
  ([Expo Audio docs](https://docs.expo.dev/versions/latest/sdk/audio/)).
- **`expo-widgets` is stable in Expo SDK 56**, building widgets and Live
  Activities as React components with `@expo/ui`, no SwiftUI required
  ([Expo blog](https://expo.dev/blog/ios-widgets-and-live-activities-in-expo)).
  This was previously recorded as second-hand; it is now confirmed.
- **WatchConnectivity delivery semantics** — `sendMessage` immediate and
  requiring reachability, `updateApplicationContext` latest-only,
  `transferUserInfo` FIFO and guaranteed
  ([Three ways to communicate via WatchConnectivity](https://alexanderweiss.dev/blog/2023-01-18-three-ways-to-communicate-via-watchconnectivity)).

### Not verified — do not build a plan on these

- **Whether App Intent buttons in a *mirrored* Live Activity are interactive
  from the Smart Stack.** WWDC24 establishes the presentation and the tap
  behaviour, not the buttons. An Apple developer-forum thread reports them
  initially broken in watchOS 11 and fixed in a later seed, which is
  corroboration but not confirmation. **Test on a device before "end and flag
  from the wrist without a watch app" appears in a plan** — if it turns out to be
  display-only, that single fact is the strongest argument for the watchOS
  target.
- **The React Native ↔ WatchConnectivity binding.** Two candidates exist —
  `react-native-watch-connectivity` (which explicitly does *not* let you write
  the watch app in React Native) and an Expo-module alternative — and **neither
  has been evaluated against Expo SDK 54 or the New Architecture**. This package
  therefore ships the decision layer and no native module. Budget a day, and
  keep writing a small Expo module in scope: the surface is two commands and one
  snapshot.
- **`@bacons/apple-targets`' watch guide specifically.** The plugin's
  watch-specific documentation page could not be reached from the environment
  this was written in, so `defineWatchTarget` emits the *general* documented
  config shape with `type: "watch"` rather than a transcription of a verified
  watch example. Treat the first `npx expo prebuild --clean` as the test.
- **Whether `sendMessage` reliably wakes the iOS app for `start`** when the app
  is not running. Documented behaviour; not tested here, and it is the one
  behaviour the "start from the wrist" story depends on.
- **The SDK to land on.** SDK 56 is where `expo-widgets` is stable; SDK 56 also
  carries a reported Hermes V1 memory regression affecting
  `react-native-worklets` and `react-native-reanimated`, reported resolved in
  SDK 57. Check the changelog against your own dependency list before choosing.

Also worth knowing, and platform-level rather than uncertain: **`SpeechAnalyzer`
ships on iOS/iPadOS/macOS/tvOS/visionOS 26 and not watchOS**, which is the
platform half of "the watch is a remote control, never a recorder".

## Native dependency classification

A Supa app classifies every native dependency in `native-deps.json` or CI fails.

- **`@bacons/apple-targets` adds no runtime native module** — it generates
  targets at prebuild time. It belongs in `devDependencies` and needs no entry.
- **A WatchConnectivity module is `core`**, not `gated`: a build without it
  cannot talk to the watch at all, so there is no meaningful runtime fallback to
  gate behind.
- **Adding a target does not require a `runtimeVersion` bump.** Adopting
  `expo-widgets` means moving to SDK 56+, and an SDK upgrade that moves the ABI
  does. Plan the two together.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework.
MIT licensed.
