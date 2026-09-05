/**
 * The Electron implementation of `PermissionBroker`, and two macOS facts.
 *
 * **The microphone and camera can be asked for; Screen Recording cannot.**
 * `systemPreferences.askForMediaAccess()` raises the system dialog for
 * `"microphone"` and `"camera"` and resolves with the answer. There is no
 * equivalent for screen capture: the only way to raise that prompt is to
 * *attempt a capture*, which macOS intercepts. So `request("screen")` reports
 * the status as it stands and leaves the prompt to the first
 * `getDisplayMedia()` call — and the app should say what is about to happen
 * rather than pretending a dialog is coming from it.
 *
 * **`not-determined` is the only status worth asking about.** A `denied`
 * permission cannot be re-prompted — macOS ignores the call — so the app must
 * send the person to System Settings instead of spinning on a dialog that will
 * never appear. `ensurePermissions` in the core already never calls `request`
 * for a denied permission; this file would be harmless if it did, and the two
 * halves are split precisely because that one can be tested and this one
 * cannot.
 *
 * On Windows and Linux every status is `"unknown"`, which `ensurePermissions`
 * treats as "ask" — and `request` answers `"granted"`, because those platforms
 * gate capture at the device rather than with a pre-flight prompt. An app that
 * needs a real answer there should say so at the point of capture.
 */

import { shell, systemPreferences } from "electron";

/** Which System Settings pane to open for a permission a person refused. */
const PANES = Object.freeze({
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
  calendars: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
});

/** Kinds `getMediaAccessStatus` understands. Everything else is `"unknown"`. */
const MEDIA_KINDS = new Set(["microphone", "camera", "screen"]);

/** Kinds `askForMediaAccess` can actually raise a dialog for. See the header. */
const ASKABLE_KINDS = new Set(["microphone", "camera"]);

function translate(status) {
  switch (status) {
    case "granted":
    case "denied":
    case "restricted":
    case "not-determined":
      return status;
    default:
      return "unknown";
  }
}

/** @returns {import("../core/permissions.js").PermissionBroker} */
export function electronPermissionBroker() {
  return {
    async status(kind) {
      if (process.platform !== "darwin") return "unknown";
      if (!MEDIA_KINDS.has(kind)) return "unknown";
      return translate(systemPreferences.getMediaAccessStatus(kind));
    },
    async request(kind) {
      if (process.platform !== "darwin") return "granted";
      if (ASKABLE_KINDS.has(kind)) {
        const granted = await systemPreferences.askForMediaAccess(kind);
        return granted ? "granted" : "denied";
      }
      if (MEDIA_KINDS.has(kind)) {
        // See the header: no API raises this prompt. Report where it stands and
        // let the capture attempt do it.
        return translate(systemPreferences.getMediaAccessStatus(kind));
      }
      return "unknown";
    },
  };
}

/**
 * Open the System Settings pane for a permission, so "go and turn it on" is one
 * click rather than a paragraph of instructions.
 *
 * @param {keyof typeof PANES | string} kind
 */
export async function openPermissionSettings(kind) {
  if (process.platform !== "darwin") return false;
  const pane = PANES[kind];
  if (!pane) return false;
  await shell.openExternal(pane);
  return true;
}
