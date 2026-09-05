/**
 * `@supa-media/desktop/electron` — everything that needs the runtime.
 *
 * Importing this module imports `electron`, so it must never be reached from an
 * app's `core/` (the `check-core-isolation` bin proves that) and it cannot be
 * loaded by `node --test`. Everything here is a thin wrapper whose decisions
 * were already made by a pure function in `@supa-media/desktop`.
 */

export {
  createPanelWindow,
  createAppWindow,
  createHiddenWindow,
  positionUnderTray,
  revealQuietly,
  markQuitting,
  isQuitting,
} from "./windows.js";

export { createTray, svgImage } from "./tray.js";
export { defineBridge } from "./bridge.js";
export { createJsonStore } from "./store.js";
export { safeStorageTokenStore } from "./tokenStore.js";
export { electronPermissionBroker, openPermissionSettings } from "./permissions.js";
