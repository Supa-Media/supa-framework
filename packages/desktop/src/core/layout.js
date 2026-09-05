/**
 * Where a menu-bar panel goes, as arithmetic rather than as a guess.
 *
 * "Position the panel under the tray icon" reads like one line and is not: a
 * naive `x = trayBounds.x` puts the panel's left edge under the icon rather than
 * its centre, and an icon near the right-hand end of the menu bar then opens a
 * panel that runs off the screen — which on macOS is not clipped but *shifted*,
 * so it detaches from the icon it belongs to. On a machine with two displays
 * the same arithmetic against the primary display's size puts the panel on the
 * wrong screen entirely.
 *
 * So the maths is here, pure, with the display's work area passed in, and
 * `../electron/windows.js` is the four lines that ask Electron which display
 * the tray icon is on. That split is what makes the edge cases testable at all:
 * they are the cases you cannot reproduce without a second monitor and a
 * cluttered menu bar.
 *
 * **Bottom-edge taskbars are handled too.** macOS puts the menu bar at the top;
 * Windows and most Linux desktops put the tray at the bottom by default. A
 * panel placed "below" a bottom tray icon is off-screen, so an icon sitting in
 * the lower half of the work area gets a panel above it instead.
 */

/**
 * @param {object} input
 * @param {{ x: number, y: number, width: number, height: number }} input.tray the tray icon's bounds, in screen coordinates
 * @param {{ width: number, height: number }} input.panel the panel's size
 * @param {{ x: number, y: number, width: number, height: number }} input.workArea the work area of the display the icon is on
 * @param {number} [input.gap] between the icon and the panel
 * @param {number} [input.margin] the closest the panel may come to a screen edge
 * @returns {{ x: number, y: number, placement: "below" | "above" }}
 */
export function panelPositionUnderTray({ tray, panel, workArea, gap = 6, margin = 8 }) {
  const centred = tray.x + tray.width / 2 - panel.width / 2;
  const leftLimit = workArea.x + margin;
  // `width - panel.width - margin` can fall below `leftLimit` on a display
  // narrower than the panel. `Math.max` is applied last so the panel stays
  // pinned to the left edge rather than being clamped off the left of the
  // screen by a right-hand limit that is smaller than the left one.
  const rightLimit = workArea.x + workArea.width - panel.width - margin;
  const x = Math.round(Math.max(leftLimit, Math.min(centred, rightLimit)));

  const trayCentreY = tray.y + tray.height / 2;
  const belowFits = tray.y + tray.height + gap + panel.height <= workArea.y + workArea.height;
  const inLowerHalf = trayCentreY > workArea.y + workArea.height / 2;
  const placement = !belowFits && inLowerHalf ? "above" : "below";

  const y =
    placement === "above"
      ? Math.round(Math.max(workArea.y + margin, tray.y - gap - panel.height))
      : Math.round(Math.min(tray.y + tray.height + gap, workArea.y + workArea.height - panel.height - margin));

  return { x, y, placement };
}
