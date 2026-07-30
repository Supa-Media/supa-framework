---
"@supa-media/native-safety": minor
---

New bin: `check-ota-native-parity` — refuses to publish an OTA update whose
native dependency versions disagree with the native binary users actually have
installed.

An `eas update` ships JavaScript only; it cannot change the native code compiled
into an installed binary. So bumping an `expo-*` / `react-native-*` version is a
NATIVE change wearing a one-line-JSON disguise: the new JS goes out over the air,
the old native module stays on the device, and the two halves of the same package
are now different majors. For a package with a native view that surfaces as
`ViewManagerAdapter_… must be a function (received undefined)` at render time —
and on Fabric that invariant corrupts the view registry, so it also breaks
UNRELATED native rendering elsewhere in the app.

Togather shipped exactly this and it survived four months and three attempted
fixes: `expo-video` was downgraded `^55.0.11` → `^3.0.16` the day after the
production binary was built with v55, and every production OTA since carried v3
JS to a v55 binary — chat video fell back to a download card and animated GIFs on
an unrelated screen went blank. Its sibling `expo-audio` took the same skew, was
noticed (voice recording broke), and was pinned back; video was left behind with
the note "works fine in staging". See Togather's ADR-013 postmortem.

Nothing already in the toolbox could catch it:

- **Typecheck / tests / bundling** never see it (native modules are mocked, the
  bundle builds, web E2E never touches Fabric).
- **A staging environment can't see it either**, and this is the trap: apps
  typically rebuild the staging binary on every push, so staging's native code
  always matches the current lockfile and the skew is invisible there *by
  construction*. "Verified on staging" is not evidence for a native-graph change.
- **`check-fingerprint` can't see it**, because it compares the working tree to a
  checked-in baseline that `--update` can rewrite in the very commit that
  introduces the skew. It answers "did native inputs change since someone last
  said they were fine?", not "does this JS match the binary users have?".

The new check answers the second question by asking the build service which
commit the deployed binary was compiled from, reading the app's `package.json`
out of git history **at that commit**, and diffing its native dependencies
against the working tree's. Added, removed, and changed native deps all fail.

It **fails closed** by design: no finished build for the profile, a build with no
`gitCommitHash`, or a commit that can't be fetched are failures, not skips — a
guard that passes when it cannot do its job is the gap this exists to remove.
With `--platform all`, every platform that has a build must match, since one OTA
reaches all of them. Only runtime `dependencies` are considered (a native-looking
devDependency isn't autolinked, so moving it isn't a native change).

Usage — run it immediately before publishing a production OTA:

```
eas build:list --platform all --build-profile production \
  --status finished --limit 30 --json --non-interactive > builds.json

npx check-ota-native-parity \
  --pkg apps/mobile/package.json \
  --config apps/mobile/native-deps.json \
  --builds-json builds.json --profile production --platform all
```

`--build-commit <sha>` skips the EAS lookup when the commit is already known.
Failures print the offending packages with both versions and the two legitimate
resolutions (ship a native build from this commit, or restore the versions the
binary has), plus an explicit warning not to "fix" it by re-baselining a
fingerprint file.
