/**
 * The app: a tray, a panel, a settings file, and the wiring between them.
 *
 * This file holds no rules of its own. What the menu bar says is
 * `core/tray.js`; what a broken settings file resolves to is `core/settings.js`;
 * what a window may ask for is `shared/bridge.js`. Everything worth arguing
 * about is a pure function with a check beside it, and what is left here is
 * Electron.
 *
 * That is not tidiness for its own sake — it is why `pnpm test` in this app
 * runs in under a second with Electron not installed, and why
 * `check-core-isolation` is in the test script.
 */

import { app } from "electron";
import { join } from "node:path";
import {
  createJsonStore,
  createPanelWindow,
  createTray,
  markQuitting,
  positionUnderTray,
  svgImage,
} from "@supa-media/desktop/electron";
import { settings } from "../core/settings.js";
import { tray as trayStates } from "../core/tray.js";
import { bridge } from "../shared/bridge.js";

const RENDERER_DIR = join(import.meta.dirname, "..", "renderer");

/**
 * The menu-bar marks, drawn as inline SVG rather than shipped as assets — a
 * mark is a dozen path commands, and a build that copies four PNGs at three
 * scale factors is a build that ships one of them missing.
 *
 * The `working` mark is deliberately **not** a template image. macOS recolours
 * a template image to match the menu bar, which is right for every quiet state
 * and wrong for the one whose entire job is to be noticed.
 */
const ICONS = {
  idle: () =>
    svgImage(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="black" stroke-width="1.6"/></svg>',
    ),
  watching: () =>
    svgImage(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="black" stroke-width="1.6"/><circle cx="8" cy="8" r="2" fill="black"/></svg>',
    ),
  working: () =>
    svgImage(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="#DC2626"/></svg>',
      { template: false },
    ),
};

let current = settings.defaults;

async function main() {
  // A menu-bar presence, not a dock app.
  app.dock?.hide();

  const store = createJsonStore(app.getPath("userData"), {
    settings: { file: "settings.json", normalize: settings.normalize },
  });
  current = await store.read("settings");

  const panel = createPanelWindow({ rendererDir: RENDERER_DIR, page: "panel.html", height: 260 });

  const tray = createTray({
    icons: ICONS,
    initialIcon: "idle",
    onClick: (bounds) => {
      if (panel.isVisible()) {
        panel.hide();
        return;
      }
      positionUnderTray(panel, bounds);
      // `showInactive`, never `show`: a panel that takes focus while somebody
      // is mid-sentence is a panel they close by quitting the app.
      panel.showInactive();
    },
    menu: () => [
      { label: current.watching ? "Pause" : "Start watching", click: () => void update({ watching: !current.watching }) },
      { type: "separator" },
      { label: "Quit {{APP_NAME}}", click: () => app.quit() },
    ],
  });

  function push() {
    const presentation = trayStates.present({ state: current.watching ? "watching" : "idle" });
    tray.render(presentation);
    bridge.push([panel], "state", { tray: presentation, settings: current });
  }

  async function update(patch) {
    current = { ...current, ...patch };
    await store.write("settings", current);
    push();
  }

  bridge.handle({
    setWatching: (value) => void update({ watching: Boolean(value) }),
    openSettings: () => {
      positionUnderTray(panel, tray.bounds());
      panel.showInactive();
    },
    quit: () => app.quit(),
  });

  // Without this, a close-to-hide window refuses to close and the app will not
  // exit. Harmless here, load-bearing the moment you add a real window.
  app.on("before-quit", () => markQuitting());

  push();
}

app.whenReady().then(main);

// No windows means no app on macOS — except this one, which is a menu bar.
app.on("window-all-closed", () => undefined);
