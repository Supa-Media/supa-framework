"use strict";

/**
 * `expo-target.config.js` files, generated rather than copy-pasted.
 *
 * `@bacons/apple-targets` reads one of these per target directory. There are
 * only a handful of keys, and the reason to generate them anyway is the App
 * Group: it is the single string the app, the widget extension and the watch
 * app all have to agree on, and three files typing it separately is three
 * chances to disagree by a character and get a silently empty shared
 * `UserDefaults` at run time.
 *
 * ## What is verified and what is not
 *
 * The key set below — `type`, `name`, `displayName`, `bundleIdentifier`,
 * `deploymentTarget`, `icon`, `colors`, `images`, `frameworks`, `entitlements`,
 * `exportJs` — is the documented shape from the plugin's own README, which also
 * lists `watch` and `watch-widget` among the supported types. That README is
 * candid that its target list comes from static analysis of common target types
 * and that not all of them are tested. **The watch-specific guide page could not
 * be reached from the environment this was written in**, so the watch shape here
 * is the general shape with `type: "watch"`, not a transcription of a verified
 * watch example. Treat the first `npx expo prebuild --clean` as the test.
 *
 * The plugin's stated requirements at the time of writing: Expo SDK 53+,
 * Xcode 16, CocoaPods 1.16.2, macOS 15, and `ios.appleTeamId` in the app config.
 */

const APP_GROUPS_KEY = "com.apple.security.application-groups";

function base(type, options) {
  if (!options || typeof options.appGroup !== "string") {
    throw new Error(`a ${type} target needs an appGroup — it is the only thing the app and the target share`);
  }
  const target = {
    type,
    name: options.name,
    displayName: options.displayName,
    bundleIdentifier: options.bundleIdentifier,
    deploymentTarget: options.deploymentTarget,
    icon: options.icon,
    colors: options.colors,
    images: options.images,
    frameworks: options.frameworks,
    entitlements: {
      ...options.entitlements,
      // Declared explicitly even though the plugin mirrors the app's array:
      // mirroring is the default, an override is silent, and a target reading a
      // different group than the app writes is the failure mode with no error
      // message at all.
      [APP_GROUPS_KEY]: [options.appGroup],
    },
  };
  // Undefined keys are dropped rather than written, so the generated file reads
  // as what was actually decided.
  for (const key of Object.keys(target)) {
    if (target[key] === undefined) delete target[key];
  }
  return target;
}

/**
 * A watchOS app target.
 *
 * A watch app in this configuration requires the paired iOS app and does not
 * run standalone — which is what you want when the phone is the authority and
 * holds the recording. It is a **SwiftUI codebase**: none of the app's React
 * Native code, design tokens, auth session or Convex client is available on it,
 * and everything it shows has to be pushed to it as data. It is also **native,
 * so it is outside the OTA channel**: a bug in the watch UI ships with a new
 * binary through the App Store, not in an afternoon.
 *
 * @param {object} options
 * @param {string} options.appGroup
 * @param {string} [options.name]
 * @param {string} [options.displayName]
 * @param {string} [options.bundleIdentifier] relative (`".watch"`) or absolute
 * @param {string} [options.deploymentTarget] watchOS version
 * @param {string} [options.icon]
 * @param {readonly string[]} [options.frameworks]
 * @param {Record<string, unknown>} [options.entitlements]
 */
function defineWatchTarget(options) {
  return base("watch", {
    deploymentTarget: "11.0",
    frameworks: ["SwiftUI", "WatchConnectivity"],
    ...options,
  });
}

/**
 * A widget-extension target — where a Live Activity lives when it is written in
 * SwiftUI.
 *
 * If you would rather write the Live Activity as React components, that is
 * `expo-widgets` (first-party, reported stable in Expo SDK 56) and not this
 * target. This helper is for the SwiftUI route, and for home-screen widgets.
 *
 * @param {object} options same shape as `defineWatchTarget`
 */
function defineWidgetTarget(options) {
  return base("widget", {
    deploymentTarget: "17.0",
    frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
    ...options,
  });
}

/**
 * A watch-face complication / watch widget target.
 *
 * The one thing a mirrored Live Activity cannot give you: a mirrored activity
 * appears in the Smart Stack, never on the watch face.
 *
 * @param {object} options same shape as `defineWatchTarget`
 */
function defineWatchWidgetTarget(options) {
  return base("watch-widget", {
    deploymentTarget: "11.0",
    frameworks: ["SwiftUI", "WidgetKit"],
    ...options,
  });
}

/**
 * Render a target config as the contents of an `expo-target.config.js` file.
 *
 * @param {object} target
 * @param {string} [note] a sentence written above the export
 */
function renderTargetConfig(target, note) {
  const header = note ? `/** ${note} */\n` : "";
  return `${header}/** @type {import("@bacons/apple-targets").Config} */\nmodule.exports = ${JSON.stringify(target, null, 2)};\n`;
}

module.exports = {
  defineWatchTarget,
  defineWidgetTarget,
  defineWatchWidgetTarget,
  renderTargetConfig,
};
