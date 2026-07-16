---
"@supa-media/native-safety": minor
---

Add `check-react-consistency` CI script, a static/lockfile check that catches a
second React entering an Expo app's native module graph and a denylist of
web-only React libs (MUI, emotion, styled-components) known to cause it.

This closes the gap next to `@supa-media/testing`'s react-resolution guard,
which checks the actual installed `node_modules` layout at runtime — this new
check runs earlier, against `pnpm-lock.yaml` directly, without an install.

Ported unchanged (detection logic) from Togather's battle-tested
`apps/mobile/scripts/check-react-consistency.js`, written after Togather's
PR #548 shipped a regression where adding `@mui/*` + `@emotion/*` for a web
datepicker pulled a second React into the shared pnpm lockfile via
`autoInstallPeers`. That re-keyed `expo-modules-core` and other Expo/RN native
packages onto the second React, which silently broke native Fabric view/module
registration on the installed binary — video and animated GIFs rendered blank
— while typecheck, tests, and the JS bundle all passed, because native modules
are mocked in tests and the JS bundle doesn't care which React a native module
is peer-keyed to. See Togather's ADR-013 postmortem for the full story.

Usage:

```
npx @supa-media/native-safety check-react-consistency \
  --pkg apps/mobile/package.json \
  --lockfile pnpm-lock.yaml \
  --config apps/mobile/native-deps.json
```

`--pkg` and `--lockfile` are required and generalize Togather's hardcoded
`apps/mobile` paths into arguments (following the `check-native-imports`
convention). `--config` optionally points at a `native-deps.json` ({ core,
gated }) to catch scoped native packages the name-prefix heuristic can't
express, and its new optional `nativeUnsafeDenylist` array (or the `--denylist`
flag) extends the default MUI/emotion/CSS-in-JS denylist with app-specific
web-only React libraries — Togather's four-entry list ships as the default,
unchanged.
