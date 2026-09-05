/**
 * This app's own checks. Offline, no Electron, no build step.
 *
 * That is possible because everything in `src/core` and `src/shared` is a pure
 * function or a declaration, and `check-core-isolation` — the first half of the
 * `test` script — is what keeps it that way. When somebody reaches for
 * `dialog.showMessageBox` inside a reducer, that command fails with the file
 * and line rather than this suite quietly becoming unloadable.
 *
 * Add checks here as you add rules. The two below are the ones worth having on
 * day one, because both are about the app's *safe* direction.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { settings } from "../src/core/settings.js";
import { tray } from "../src/core/tray.js";

test("a broken settings file resolves to the safe state", () => {
  for (const raw of [undefined, null, "not an object", { version: 99, watching: true }]) {
    const resolved = settings.normalize(raw);
    assert.equal(resolved.watching, false, `watching for ${JSON.stringify(raw)}`);
  }
  // ...and a denylist survives a record this build cannot otherwise read.
  assert.deepEqual(settings.normalize({ version: 99, denylist: ["something"] }).denylist, ["something"]);
});

test("no tray state is doing something privileged without saying so", () => {
  for (const name of tray.states) {
    assert.equal(
      tray.present({ state: name }).indicator,
      tray.capturingStates.includes(name),
      `${name} indicator must match its capturing flag`,
    );
  }
});
