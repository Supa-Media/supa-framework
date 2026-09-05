/**
 * The watchOS target.
 *
 * `@bacons/apple-targets` reads this file and generates the Xcode target from
 * it. The Swift sources live beside it, in this directory, outside the
 * generated `ios/` — which is what lets the app stay on Continuous Native
 * Generation with a native target in it.
 *
 * Create the rest of the target with the plugin's own scaffolder rather than by
 * hand:
 *
 *     npx create-target watch
 *     npx expo prebuild -p ios --clean
 *
 * and re-run the prebuild whenever this file or `app.config.js` changes.
 *
 * The App Group is stated here as well as in `app.config.js` on purpose. The
 * plugin mirrors the app's array into targets that can use App Groups, and a
 * target may override it — so a mismatch is silent: the watch app builds,
 * installs, runs, and reads a different shared container than the phone writes.
 * Both sides derive it from the same bundle identifier through
 * `appGroupIdentifier`, so there is one string and no chance to mistype it
 * twice.
 *
 * Remember what this target is and is not:
 *
 *  - It is **SwiftUI**. None of the app's React Native code, design tokens,
 *    auth session or Convex client exists here.
 *  - It is **native**, so it is outside the OTA channel: a fix ships with a new
 *    binary through the App Store.
 *  - It **requires the paired phone** and must render a coherent "no session"
 *    state when the phone is absent — an error screen there is a review risk.
 *    `defineWatchBridge(...).presentState(null, …)` returns exactly that shape.
 */

const { appGroupIdentifier, defineWatchTarget } = require("@supa-media/apple-targets");

module.exports = defineWatchTarget({
  appGroup: appGroupIdentifier(
    process.env.APP_ENV === "staging" ? "{{STAGING_BUNDLE_ID}}" : "{{BUNDLE_ID}}",
  ),
  name: "watch",
  displayName: "{{APP_NAME}}",
  // Point this at a 1024×1024 PNG once you have one.
  // icon: "../../assets/icon.png",
});
