"use strict";

/**
 * The app config a watch target and a Live Activity need.
 *
 * Two of these are worth more than they look. The App Group is the only name
 * three targets share, and a mismatch there produces an empty shared
 * `UserDefaults` with no error anywhere; and a team id written into a public
 * `app.config.js` is an account identifier committed to a public repository,
 * which is not a leak you can undo with a force-push.
 *
 * ## Sabotage record
 *
 *   the `group.` prefix check removed                                    1 failure
 *   `withAppleTargets` mutating the input config                         1 failure
 *   the plugin appended unconditionally (not idempotent)                 2 failures
 *   the team-id requirement dropped                                      1 failure
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { APP_GROUPS_KEY, appGroupIdentifier, withAppleTargets } = require("../src/index.js");

const TEAM = "TESTTEAM00";
const bundleId = "com.example.app";
const appGroup = appGroupIdentifier(bundleId);

const config = () => ({
  name: "Example",
  slug: "example",
  plugins: ["expo-router"],
  ios: { bundleIdentifier: bundleId, infoPlist: { NSMicrophoneUsageDescription: "why" } },
});

test("the App Group is derived from the bundle id, once", () => {
  assert.equal(appGroup, "group.com.example.app");
  assert.throws(() => appGroupIdentifier(""), /needs a bundle identifier/);
});

test("an App Group must be reverse-DNS under `group.`", () => {
  assert.throws(() => withAppleTargets(config(), { appGroup: "com.example.app", appleTeamId: TEAM }), /must start with/);
  assert.throws(() => withAppleTargets(config(), { appGroup: "group.", appleTeamId: TEAM }), /must start with/);
  assert.throws(() => withAppleTargets(config(), { appGroup: 7, appleTeamId: TEAM }), /must start with/);
});

test("THE APP GROUP LANDS WHERE TARGETS MIRROR IT FROM", () => {
  const next = withAppleTargets(config(), { appGroup, appleTeamId: TEAM });
  assert.deepEqual(next.ios.entitlements[APP_GROUPS_KEY], [appGroup]);
  assert.equal(next.ios.appleTeamId, TEAM);
});

test("an existing entitlement array is extended rather than replaced", () => {
  const withExisting = config();
  withExisting.ios.entitlements = { [APP_GROUPS_KEY]: ["group.com.example.other"], "aps-environment": "development" };
  const next = withAppleTargets(withExisting, { appGroup, appleTeamId: TEAM });
  assert.deepEqual(next.ios.entitlements[APP_GROUPS_KEY], ["group.com.example.other", appGroup]);
  assert.equal(next.ios.entitlements["aps-environment"], "development", "unrelated entitlements survive");
});

test("applying it twice changes nothing the second time", () => {
  const once = withAppleTargets(config(), { appGroup, appleTeamId: TEAM, backgroundModes: ["audio"] });
  const twice = withAppleTargets(once, { appGroup, appleTeamId: TEAM, backgroundModes: ["audio"] });
  assert.deepEqual(twice, once);
  assert.deepEqual(twice.plugins, ["expo-router", "@bacons/apple-targets"]);
  assert.deepEqual(twice.ios.infoPlist.UIBackgroundModes, ["audio"]);
});

test("a plugin already configured with options is left alone", () => {
  const configured = config();
  configured.plugins = ["expo-router", ["@bacons/apple-targets", { some: "option" }]];
  const next = withAppleTargets(configured, { appGroup, appleTeamId: TEAM });
  assert.equal(next.plugins.length, 2, "the configured entry is not shadowed by a bare one");
});

test("the input config is never mutated", () => {
  const original = config();
  const snapshot = JSON.parse(JSON.stringify(original));
  withAppleTargets(original, { appGroup, appleTeamId: TEAM, backgroundModes: ["audio"] });
  assert.deepEqual(original, snapshot);
});

test("background modes are merged, deduplicated, and absent when not asked for", () => {
  const plain = withAppleTargets(config(), { appGroup, appleTeamId: TEAM });
  assert.equal("UIBackgroundModes" in plain.ios.infoPlist, false, "not added speculatively");
  assert.equal(plain.ios.infoPlist.NSMicrophoneUsageDescription, "why", "existing keys survive");

  const withMode = config();
  withMode.ios.infoPlist.UIBackgroundModes = ["audio"];
  const next = withAppleTargets(withMode, { appGroup, appleTeamId: TEAM, backgroundModes: ["audio", "processing"] });
  assert.deepEqual(next.ios.infoPlist.UIBackgroundModes, ["audio", "processing"]);
});

test("A MISSING TEAM ID IS AN ERROR, NOT A PLACEHOLDER IN A PUBLIC FILE", () => {
  const saved = process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_TEAM_ID;
  try {
    assert.throws(() => withAppleTargets(config(), { appGroup }), /APPLE_TEAM_ID/);
    process.env.APPLE_TEAM_ID = TEAM;
    assert.equal(withAppleTargets(config(), { appGroup }).ios.appleTeamId, TEAM, "read from the environment");
  } finally {
    if (saved === undefined) delete process.env.APPLE_TEAM_ID;
    else process.env.APPLE_TEAM_ID = saved;
  }
});

test("the plugin list can be managed by the app instead", () => {
  const next = withAppleTargets(config(), { appGroup, appleTeamId: TEAM, plugin: false });
  assert.deepEqual(next.plugins, ["expo-router"]);
  assert.deepEqual(next.ios.entitlements[APP_GROUPS_KEY], [appGroup], "but the entitlement is still set up");
});
