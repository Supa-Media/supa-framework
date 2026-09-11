# @supa-media/desktop

## 0.2.0

### Minor Changes

- 046b80a: Two new opt-in surfaces, lifted from a shipped menu-bar app.

  **`@supa-media/desktop`** is the generic Electron shell: menu-bar tray lifecycle
  and state presentation, panel/app/hidden windows with tray-relative positioning
  (centred, clamped to the display the icon is actually on, flipped above a
  bottom-edge taskbar), the preload bridge pattern, a settings store that repairs
  a broken file onto the safe value for every field, the offline outbox + drain +
  `safeStorage` token store, and the esbuild pass over main/preload/renderer.

  Its claim is the split: everything that decides is a pure function under
  `@supa-media/desktop` and runs under `node --test` with Electron not installed,
  while everything that does is a thin wrapper under
  `@supa-media/desktop/electron`. A `check-core-isolation` bin enforces the same
  rule in a consuming app.

  Two invariants are structural rather than tested: a tray state declares
  `capturing` and cannot declare `indicator`, so a capturing state with no
  always-on indicator is unwritable; and the bridge has no request/response
  direction, so there is no channel a renderer could call to read a credential.

  **`@supa-media/apple-targets`** is the scaffolding for a watchOS target and a
  Live Activity on the Expo app: `withAppleTargets()` for the App Group
  entitlement, `ios.appleTeamId` (read from the environment, never committed) and
  `UIBackgroundModes`; `defineWatchTarget()` and friends for
  `expo-target.config.js`; and `defineWatchBridge()` for the WatchConnectivity
  rules — `sendMessage` for commands that are wrong when late,
  `updateApplicationContext` for the latest-only snapshot, `transferUserInfo` for
  the ones that are still true when late, with the queued command's timestamp
  computed at the press rather than on arrival.

  Its README separates what is verified against a primary source from what is not,
  and names the two facts a plan must not be built on yet: whether App Intent
  buttons in a mirrored Live Activity are interactive from the watch Smart Stack,
  and which React Native ↔ WatchConnectivity binding works on this configuration.

  `create-supa-app` asks about both, off by default, and its `.conditional-{flag}`
  template mechanism now applies to directories as well as files.
