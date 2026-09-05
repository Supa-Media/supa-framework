/**
 * The windows a menu-bar app has, and the rules each one is created under.
 *
 * **A panel** is a menu-bar popover: frameless, always on top, no taskbar entry,
 * positioned under the tray icon, and dismissed on blur. A popover that has to
 * be dismissed deliberately is a popover people close by quitting the app.
 *
 * **A main window** is somewhere a person works for an hour. Two rules that
 * look like details and are not:
 *
 *  - It is revealed with `showInactive()`, not `show()`. An app whose window
 *    appears *during* something — a call, a presentation, a recording — and
 *    takes focus mid-sentence is an app people turn off. `revealQuietly` is
 *    that entire rule.
 *  - Closing it hides it rather than destroying it, so a person who dismisses
 *    the window keeps whatever they had typed and whatever is still running.
 *    That refusal has to stop applying when the app is genuinely quitting, or
 *    `app.quit()` becomes a window that will not close — call `markQuitting()`
 *    from `before-quit`.
 *
 * Every window here is created with `contextIsolation: true` and
 * `nodeIntegration: false`, and there is no option to turn either off. These
 * windows render text the app collected from the machine — window titles,
 * document names, calendar summaries — which is attacker-controlled on any
 * machine where somebody else can name a file.
 */

import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { panelPositionUnderTray } from "../core/layout.js";

/**
 * Set once, when the app is genuinely quitting. Module-scoped because there is
 * exactly one app, and because every close handler has to agree about it.
 */
let quitting = false;

export function markQuitting() {
  quitting = true;
}

export function isQuitting() {
  return quitting;
}

/**
 * `sandbox: true` is the default, which is stricter than Electron's own default
 * for a window with a preload. A sandboxed preload may `require` only Electron
 * and a few polyfilled built-ins, so a bundled preload that talks to `electron`
 * and nothing else — the shape `defineBridge` produces — works unchanged, and a
 * preload that wanted `node:fs` is told to move that work into the main
 * process, which is the discipline this package exists to hold.
 *
 * `unsafeAllowNodeInPreload` is the escape hatch, named so that it shows up in
 * a diff rather than hiding behind `sandbox: false`.
 */
function webPreferences(rendererDir, preload, unsafeAllowNodeInPreload) {
  return {
    preload: join(rendererDir, preload),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: unsafeAllowNodeInPreload !== true,
  };
}

/**
 * A frameless popover that lives under the tray icon.
 *
 * @param {object} options
 * @param {string} options.rendererDir directory holding the built HTML and preload
 * @param {string} options.page the HTML file, e.g. `"panel.html"`
 * @param {string} [options.preload]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {string} [options.backgroundColor] `"#00000000"` with `transparent` for a floating rounded card
 * @param {boolean} [options.transparent]
 * @param {boolean} [options.hideOnBlur]
 * @param {boolean} [options.unsafeAllowNodeInPreload]
 * @returns {import("electron").BrowserWindow}
 */
export function createPanelWindow(options) {
  const panel = new BrowserWindow({
    width: options.width ?? 380,
    height: options.height ?? 470,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: options.transparent ?? false,
    backgroundColor: options.backgroundColor ?? "#00000000",
    webPreferences: webPreferences(options.rendererDir, options.preload ?? "preload.js", options.unsafeAllowNodeInPreload),
  });
  // A panel raised over a full-screen video call has to be visible on that
  // space, not on the desktop the person left behind.
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  void panel.loadFile(join(options.rendererDir, options.page));
  if (options.hideOnBlur !== false) panel.on("blur", () => panel.hide());
  return panel;
}

/**
 * An ordinary window whose close button hides it. See the header.
 *
 * @param {object} options
 * @param {string} options.rendererDir
 * @param {string} options.page
 * @param {string} [options.preload]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {number} [options.minWidth]
 * @param {number} [options.minHeight]
 * @param {string} [options.backgroundColor]
 * @param {import("electron").BrowserWindowConstructorOptions["titleBarStyle"]} [options.titleBarStyle]
 * @param {boolean} [options.closeToHide]
 * @param {boolean} [options.unsafeAllowNodeInPreload]
 * @returns {import("electron").BrowserWindow}
 */
export function createAppWindow(options) {
  const window = new BrowserWindow({
    width: options.width ?? 940,
    height: options.height ?? 700,
    minWidth: options.minWidth ?? 640,
    minHeight: options.minHeight ?? 420,
    show: false,
    titleBarStyle: options.titleBarStyle ?? "hiddenInset",
    backgroundColor: options.backgroundColor ?? "#101014",
    webPreferences: webPreferences(options.rendererDir, options.preload ?? "preload.js", options.unsafeAllowNodeInPreload),
  });
  void window.loadFile(join(options.rendererDir, options.page));
  if (options.closeToHide !== false) {
    window.on("close", (event) => {
      if (quitting || window.isDestroyed()) return;
      event.preventDefault();
      window.hide();
    });
  }
  return window;
}

/**
 * A hidden window with no chrome, for work that needs a browser context but no
 * user interface — a `MediaRecorder`, a canvas, a WebCodecs pipeline.
 *
 * It is a real window rather than a `webContents` because Chromium only grants
 * media capture to a window, and it is never shown, never focusable and never
 * in the taskbar so it cannot be brought forward by accident.
 *
 * @param {{ rendererDir: string, page: string, preload?: string, unsafeAllowNodeInPreload?: boolean }} options
 * @returns {import("electron").BrowserWindow}
 */
export function createHiddenWindow(options) {
  const window = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: webPreferences(options.rendererDir, options.preload ?? "preload.js", options.unsafeAllowNodeInPreload),
  });
  void window.loadFile(join(options.rendererDir, options.page));
  return window;
}

/**
 * Put a panel under (or above) a tray icon, on the display the icon is on.
 *
 * The arithmetic — centring, edge clamping, and flipping above a bottom-edge
 * taskbar — is `panelPositionUnderTray` in the core, which is where its edge
 * cases are tested. This function's only job is to ask Electron which display
 * the icon is on, which is the part that cannot be tested without a second
 * monitor.
 *
 * @param {import("electron").BrowserWindow} panel
 * @param {import("electron").Rectangle} trayBounds
 * @param {{ gap?: number, margin?: number }} [options]
 */
export function positionUnderTray(panel, trayBounds, options = {}) {
  if (panel.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const [width, height] = panel.getSize();
  const { x, y } = panelPositionUnderTray({
    tray: trayBounds,
    panel: { width, height },
    workArea: display.workArea,
    gap: options.gap,
    margin: options.margin,
  });
  panel.setPosition(x, y, false);
}

/**
 * Show a window without taking focus, and do nothing if it is already up.
 *
 * @param {import("electron").BrowserWindow} window
 */
export function revealQuietly(window) {
  if (window.isDestroyed() || window.isVisible()) return;
  window.showInactive();
}
