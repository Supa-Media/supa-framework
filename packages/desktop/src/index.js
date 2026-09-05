/**
 * `@supa-media/desktop` — the Electron-free core.
 *
 * Nothing reachable from this entry point imports `electron`, touches the
 * filesystem, or opens a socket it was not handed. That is the whole discipline
 * the package exists to carry: everything an app *decides* lives here and is
 * checked by `node --test` in milliseconds, and everything Electron *does*
 * lives behind `@supa-media/desktop/electron`.
 *
 * `check-core-isolation` (the bin in this package) enforces the same rule
 * inside a consuming app's own `src/core/`, so the split survives the first
 * afternoon somebody needs `dialog.showMessageBox` in a reducer.
 */

export {
  defineSettings,
  boolField,
  stringField,
  enumField,
  stringListField,
  endpointField,
  acceptableEndpointUrl,
} from "./core/settings.js";

export { normalizeAppName, isDeniedApp, isDeniedUrl, isDenied, withoutDenied } from "./core/denylist.js";

export { IDLE_CONSENT, episodeKey, decideConsent, asked, answered, forgetEpisode } from "./core/consent.js";

export { defineOutbox, mergeById, backoffMs, OUTBOX_VERSION } from "./core/outbox.js";
export { postEntry, ERROR_CODES, defaultCodeForStatus, defaultRetryable } from "./core/client.js";
export { drainOnce } from "./core/drain.js";
export { memoryTokenStore } from "./core/tokenStore.js";

export { defineTray, formatElapsed } from "./core/tray.js";
export { panelPositionUnderTray } from "./core/layout.js";
export { ensurePermissions, fakePermissionBroker } from "./core/permissions.js";

export { checkCoreIsolation, DEFAULT_FORBIDDEN } from "./check-core-isolation.js";
