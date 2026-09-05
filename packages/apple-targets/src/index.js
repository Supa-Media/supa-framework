"use strict";

/**
 * `@supa-media/apple-targets` — the scaffolding for a watchOS target and a Live
 * Activity on a Supa Expo app.
 *
 * CommonJS on purpose: the primary consumer is `app.config.js`, which Expo
 * loads as CommonJS, and an ESM-only helper cannot be `require`d from there.
 *
 * See the README for what is verified, what is second-hand, and what has not
 * been tested on a device.
 */

const { APP_GROUPS_KEY, PLUGIN, appGroupIdentifier, withAppleTargets } = require("./config");
const {
  defineWatchTarget,
  defineWidgetTarget,
  defineWatchWidgetTarget,
  renderTargetConfig,
} = require("./target");
const { TRANSPORTS, defineWatchBridge } = require("./watch");

module.exports = {
  APP_GROUPS_KEY,
  PLUGIN,
  appGroupIdentifier,
  withAppleTargets,
  defineWatchTarget,
  defineWidgetTarget,
  defineWatchWidgetTarget,
  renderTargetConfig,
  TRANSPORTS,
  defineWatchBridge,
};
