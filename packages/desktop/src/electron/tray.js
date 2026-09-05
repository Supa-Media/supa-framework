/**
 * The menu bar, drawing whatever the pure function said and nothing else.
 *
 * Everything visible comes from `defineTray(...).present(...)` in the core,
 * which derives the always-on indicator from a state's `capturing` flag. This
 * file is thin so that nobody can draw a sixth thing here that disagrees with
 * it — the entire value of the split is that `render` has no branches.
 *
 * ## Icons
 *
 * Icons are supplied by the app as a name → `NativeImage` map, because icon art
 * is a design decision and the framework is not a design system. One piece of
 * knowledge does belong here, and `templateImage()` / `colouredImage()` exist to
 * carry it:
 *
 * > A macOS **template image** is recoloured by the system to match the menu
 * > bar, which is what you want for every idle and armed state — and what you
 * > must not use for a recording mark. A red dot drawn as a template image
 * > turns black on a light menu bar and white on a dark one, so the one icon
 * > whose entire job is to be noticed becomes the one icon nobody sees.
 *
 * `svgImage(svg, { template })` makes the choice explicit at the call site.
 */

import { Menu, Tray, nativeImage } from "electron";

/**
 * Build a `NativeImage` from inline SVG.
 *
 * Inline rather than a bundled asset file because a menu-bar mark is a dozen
 * path commands, and a build that has to copy four PNGs at three scale factors
 * into the right place is a build that ships one of them missing.
 *
 * @param {string} svg
 * @param {{ template?: boolean }} [options] `template: true` lets macOS recolour
 *   it with the menu bar. Pass `false` for anything that must keep its colour —
 *   see the header.
 */
export function svgImage(svg, options = {}) {
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
  );
  image.setTemplateImage(options.template !== false);
  return image;
}

/**
 * @param {object} options
 * @param {Record<string, () => import("electron").NativeImage>} options.icons keyed by the `icon` names the tray states declare
 * @param {(bounds: import("electron").Rectangle) => void} [options.onClick] left click; the bounds are what positions a panel
 * @param {() => import("electron").MenuItemConstructorOptions[]} [options.menu] built fresh on every right click, so it reflects the current state
 * @param {string} [options.initialIcon]
 */
export function createTray(options) {
  const icons = options.icons;
  const first = options.initialIcon ?? Object.keys(icons)[0];
  if (!icons[first]) throw new Error("createTray needs at least one icon");

  const tray = new Tray(icons[first]());

  if (options.onClick) {
    tray.on("click", (_event, bounds) => options.onClick(bounds));
  }
  if (options.menu) {
    // Built on demand rather than set once: a context menu attached with
    // `setContextMenu` also opens on left click on macOS, which would swallow
    // the panel toggle.
    //
    // `right-click` is macOS and Windows only — most Linux desktops render the
    // tray through StatusNotifierItem, which has no click events at all and
    // shows whatever `setContextMenu` holds. A Linux port therefore calls
    // `raw.setContextMenu(...)` and loses the left-click panel; that is a real
    // limitation rather than something this wrapper can paper over.
    tray.on("right-click", () => tray.popUpContextMenu(Menu.buildFromTemplate(options.menu())));
  }

  return {
    /**
     * @param {{ icon: string, title: string, tooltip: string }} presentation
     */
    render(presentation) {
      const icon = icons[presentation.icon];
      if (!icon) throw new Error(`no tray icon named ${JSON.stringify(presentation.icon)}`);
      tray.setImage(icon());
      // Monospaced digits so a running timer does not make the menu bar jitter
      // as the glyph widths change from one second to the next.
      tray.setTitle(presentation.title, { fontType: "monospacedDigit" });
      tray.setToolTip(presentation.tooltip);
    },
    /** Where the icon is, so a panel can be put under it. */
    bounds: () => tray.getBounds(),
    destroy: () => tray.destroy(),
    /** The underlying `Tray`, for the things this wrapper deliberately does not do. */
    raw: tray,
  };
}
