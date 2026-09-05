/**
 * Where the panel goes — the arithmetic behind a bug that only appears on
 * somebody else's machine.
 *
 * "Under the tray icon" is one line until the icon is near the right-hand end
 * of a cluttered menu bar, or on the second display, or on a Windows taskbar at
 * the bottom of the screen. Each of those needs hardware to reproduce and none
 * of them needs hardware to *check*, which is the whole reason this arithmetic
 * lives in a pure function with the work area passed in.
 *
 * ## Sabotage record
 *
 *   centring dropped (`x = tray.x`)                                      1 failure
 *   the right-hand clamp removed                                         2 failures
 *   the two clamps applied in the other order                            1 failure
 *   the bottom-taskbar flip removed                                      1 failure
 */

import test from "node:test";
import assert from "node:assert/strict";
import { panelPositionUnderTray } from "../src/index.js";

const panel = { width: 380, height: 470 };
/** A 1440×900 laptop with a 25pt menu bar. */
const mac = { x: 0, y: 25, width: 1440, height: 875 };

test("the panel is centred under the icon", () => {
  const { x, y, placement } = panelPositionUnderTray({
    tray: { x: 700, y: 0, width: 24, height: 24 },
    panel,
    workArea: mac,
  });
  assert.equal(x, Math.round(700 + 12 - 190));
  assert.equal(y, 30, "just below the icon");
  assert.equal(placement, "below");
});

test("AN ICON NEAR THE RIGHT EDGE DOES NOT OPEN A PANEL OFF THE SCREEN", () => {
  // macOS does not clip an off-screen window, it shifts it — so the panel
  // detaches from the icon it belongs to and lands somewhere unrelated.
  const { x } = panelPositionUnderTray({
    tray: { x: 1420, y: 0, width: 24, height: 24 },
    panel,
    workArea: mac,
  });
  assert.equal(x, 1440 - 380 - 8);
  assert.ok(x + panel.width <= mac.x + mac.width, "the whole panel is on screen");
});

test("an icon near the left edge is clamped the other way", () => {
  const { x } = panelPositionUnderTray({ tray: { x: 4, y: 0, width: 24, height: 24 }, panel, workArea: mac });
  assert.equal(x, 8);
});

test("a display narrower than the panel pins it to the left rather than off it", () => {
  // The right-hand limit is smaller than the left-hand one here, so the order
  // the two clamps are applied in decides whether the panel lands on screen.
  const narrow = { x: 0, y: 0, width: 300, height: 600 };
  const { x } = panelPositionUnderTray({ tray: { x: 150, y: 0, width: 24, height: 24 }, panel, workArea: narrow });
  assert.equal(x, 8);
  assert.ok(x >= narrow.x, "never off the left of the screen");
});

test("THE SECOND DISPLAY IS THE WORK AREA IT IS GIVEN, NOT THE PRIMARY'S", () => {
  // A display to the right of the primary has a positive x origin; one above
  // has a negative y. Both are wrong by a screen's width if the arithmetic
  // assumes an origin of zero.
  const right = { x: 1440, y: 0, width: 1920, height: 1080 };
  const { x, y } = panelPositionUnderTray({
    tray: { x: 3340, y: 0, width: 24, height: 24 },
    panel,
    workArea: right,
  });
  assert.equal(x, 1440 + 1920 - 380 - 8);
  assert.ok(x >= right.x, "on the display the icon is on");

  const above = { x: 0, y: -1080, width: 1920, height: 1080 };
  const upper = panelPositionUnderTray({ tray: { x: 900, y: -1080, width: 24, height: 24 }, panel, workArea: above });
  assert.equal(upper.y, -1080 + 24 + 6);
});

test("a bottom-edge taskbar puts the panel above the icon, not off the screen", () => {
  // Windows and most Linux desktops default to a bottom tray. "Below" there is
  // off the bottom of the display.
  const windows = { x: 0, y: 0, width: 1920, height: 1040 };
  const { y, placement } = panelPositionUnderTray({
    tray: { x: 1800, y: 1012, width: 24, height: 24 },
    panel,
    workArea: windows,
  });
  assert.equal(placement, "above");
  assert.equal(y, 1012 - 6 - 470);
  assert.ok(y >= windows.y, "and still on the screen");
});

test("a top-edge icon on a screen too short for the panel stays as low as it fits", () => {
  const short = { x: 0, y: 25, width: 1440, height: 300 };
  const { y, placement } = panelPositionUnderTray({
    tray: { x: 700, y: 0, width: 24, height: 24 },
    panel,
    workArea: short,
  });
  assert.equal(placement, "below");
  assert.equal(y, 25 + 300 - 470 - 8, "clamped, rather than pretending it fits");
});

test("gap and margin are configurable and integral", () => {
  const { x, y } = panelPositionUnderTray({
    tray: { x: 700, y: 0, width: 25, height: 25 },
    panel,
    workArea: mac,
    gap: 0,
    margin: 0,
  });
  assert.equal(y, 25);
  assert.equal(Number.isInteger(x), true, "a fractional position blurs a frameless window");
  assert.equal(Number.isInteger(y), true);
});
