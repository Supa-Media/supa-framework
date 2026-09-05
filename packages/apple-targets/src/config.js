"use strict";

/**
 * The `app.config.js` changes a watch target and a Live Activity need.
 *
 * Pure functions over an Expo config object, not a config plugin. Under
 * Continuous Native Generation the app config *is* the native description, and
 * everything below — entitlements, `Info.plist` keys, the plugin list, the team
 * id — is expressed there directly. Wrapping that in a plugin would add a
 * lifecycle and a `withDangerousMod` for no behaviour, and it would stop the
 * result being something you can print and read.
 *
 * `@bacons/apple-targets` is the plugin that actually generates the targets;
 * this module writes it into the plugin list and sets up what it reads.
 *
 * ## The one rule that is not cosmetic
 *
 * **The Apple Team ID comes from the environment, never from the file.** A team
 * id is not a credential, but a Supa app's repository may be public and a team
 * id is an account identifier, so it is read from `process.env.APPLE_TEAM_ID`
 * and the helper refuses a config that has neither. See the README for the
 * 1Password entry.
 */

const APP_GROUPS_KEY = "com.apple.security.application-groups";
const PLUGIN = "@bacons/apple-targets";

/** Apple requires the reverse-DNS form with a `group.` prefix. */
function assertAppGroup(appGroup) {
  if (typeof appGroup !== "string" || !appGroup.startsWith("group.") || appGroup.length <= "group.".length) {
    throw new Error(
      `appGroup must start with "group." and follow reverse-DNS (e.g. "group.com.example.app"), got ${JSON.stringify(appGroup)}`,
    );
  }
}

/**
 * Derive the conventional App Group identifier from a bundle identifier.
 *
 * A convention rather than a requirement, and worth having one: the App Group
 * is the only name shared by the app, the widget extension and the watch app,
 * and three targets guessing at it separately is three chances to disagree by a
 * character and get a silent empty `UserDefaults` at run time.
 *
 * @param {string} bundleIdentifier
 */
function appGroupIdentifier(bundleIdentifier) {
  if (typeof bundleIdentifier !== "string" || bundleIdentifier.trim() === "") {
    throw new Error("appGroupIdentifier needs a bundle identifier");
  }
  return `group.${bundleIdentifier.trim()}`;
}

function uniq(list) {
  return [...new Set(list.filter((entry) => typeof entry === "string" && entry !== ""))];
}

/**
 * Add everything an Apple companion target needs to an Expo config.
 *
 * Returns a **new** config; the input is never mutated, so this composes with
 * whatever else an `app.config.js` is doing and can be applied twice without
 * duplicating anything.
 *
 * What it does, and why each one:
 *
 *  - **`ios.entitlements[APP_GROUPS_KEY]`** — the App Group. Targets that can
 *    use App Groups mirror this array from the app config automatically, so
 *    declaring it once here is what makes the widget extension and the watch app
 *    able to read what the app wrote. Needed for the Live Activity whether or
 *    not a watch app ever exists, which is a reason to add it early rather than
 *    at the point it becomes urgent.
 *  - **`ios.appleTeamId`** — required by `@bacons/apple-targets` for signing.
 *  - **`ios.infoPlist.UIBackgroundModes`** — pass `backgroundModes: ["audio"]`
 *    if the phone keeps capturing while backgrounded. A microphone permission
 *    string alone does not survive the app leaving the foreground.
 *  - **`plugins`** — appends `@bacons/apple-targets`, idempotently.
 *
 * @param {object} config the Expo config to extend
 * @param {object} options
 * @param {string} options.appGroup e.g. `appGroupIdentifier(bundleId)`
 * @param {string} [options.appleTeamId] defaults to `process.env.APPLE_TEAM_ID`
 * @param {readonly string[]} [options.backgroundModes]
 * @param {boolean} [options.plugin] set false to manage the plugin list yourself
 * @param {Record<string, unknown>} [options.infoPlist] merged into `ios.infoPlist`
 * @param {Record<string, unknown>} [options.entitlements] merged into `ios.entitlements`
 */
function withAppleTargets(config, options) {
  if (!config || typeof config !== "object") throw new Error("withAppleTargets needs an Expo config object");
  if (!options || typeof options !== "object") throw new Error("withAppleTargets needs options");

  assertAppGroup(options.appGroup);

  const appleTeamId = options.appleTeamId ?? process.env.APPLE_TEAM_ID ?? config.ios?.appleTeamId;
  if (!appleTeamId) {
    throw new Error(
      "withAppleTargets needs an Apple Team ID: set APPLE_TEAM_ID in the environment (it is an account identifier, so it does not belong in a public app.config.js)",
    );
  }

  const ios = config.ios ?? {};
  const existingGroups = Array.isArray(ios.entitlements?.[APP_GROUPS_KEY]) ? ios.entitlements[APP_GROUPS_KEY] : [];
  const existingModes = Array.isArray(ios.infoPlist?.UIBackgroundModes) ? ios.infoPlist.UIBackgroundModes : [];

  const infoPlist = { ...ios.infoPlist, ...options.infoPlist };
  const backgroundModes = uniq([...existingModes, ...(options.backgroundModes ?? [])]);
  if (backgroundModes.length > 0) infoPlist.UIBackgroundModes = backgroundModes;

  const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];
  const hasPlugin = plugins.some((entry) => entry === PLUGIN || (Array.isArray(entry) && entry[0] === PLUGIN));
  if (options.plugin !== false && !hasPlugin) plugins.push(PLUGIN);

  return {
    ...config,
    plugins,
    ios: {
      ...ios,
      appleTeamId,
      entitlements: {
        ...ios.entitlements,
        ...options.entitlements,
        [APP_GROUPS_KEY]: uniq([...existingGroups, options.appGroup]),
      },
      infoPlist,
    },
  };
}

module.exports = { APP_GROUPS_KEY, PLUGIN, appGroupIdentifier, withAppleTargets };
