/**
 * What the menu bar says, as a pure function of what the app is doing.
 *
 * A menu-bar app has no dock icon and no window most of the time, so the tray
 * is the entire always-on user interface. When one of the states it can be in
 * is "a microphone, a camera or the screen is open right now", the tray stops
 * being a styling detail and becomes a privacy control — the only thing on
 * screen saying so.
 *
 * That is why a state declares `capturing` and **cannot** declare `indicator`.
 * `present()` derives the indicator from `capturing`, so "a capturing state
 * with no indicator" is not a bug you can write here, rather than a bug a test
 * has to catch. An app's Electron tray then draws exactly what `present()`
 * returned and nothing else — see `../electron/tray.js`, which is thin for
 * precisely this reason.
 *
 * Every word is the app's. This module owns the invariant, not the copy.
 *
 * @example
 * ```js
 * const tray = defineTray({
 *   states: {
 *     idle:      { icon: "idle",      tooltip: () => "Not watching" },
 *     armed:     { icon: "armed",     tooltip: () => "Watching" },
 *     recording: { icon: "recording", capturing: true,
 *                  title: (i) => formatElapsed(i.elapsedMs),
 *                  tooltip: (i) => `Recording ${i.title ?? "this"}` },
 *   },
 *   suffix: (i) => (i.pending ? ` · ${i.pending} waiting to save` : ""),
 * });
 *
 * tray.present({ state: "recording", elapsedMs: 42_000 });
 * // { state: "recording", title: "00:42", tooltip: "Recording this", icon: "recording", indicator: true }
 * ```
 */

/**
 * `mm:ss`, or `h:mm:ss` past an hour. Tabular by construction, and never
 * negative — a clock that has gone backwards should read `00:00` rather than
 * print nonsense into the menu bar.
 *
 * @param {number} ms
 */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Declare the tray's states.
 *
 * @param {object} definition
 * @param {Record<string, { icon: string, capturing?: boolean, title?: (input: any) => string, tooltip: (input: any) => string }>} definition.states
 * @param {(input: any) => string} [definition.suffix] appended to every tooltip
 *   — the place for "3 waiting to save" or "limited: calendar", so that every
 *   state carries it and none has to remember to
 */
export function defineTray(definition) {
  const states = definition.states;
  const names = Object.keys(states);
  if (names.length === 0) throw new Error("defineTray needs at least one state");
  for (const name of names) {
    const state = states[name];
    if (typeof state.tooltip !== "function") throw new Error(`tray state ${name} needs a tooltip function`);
    if (typeof state.icon !== "string") throw new Error(`tray state ${name} needs an icon name`);
    if ("indicator" in state) {
      // The whole point of this module. An app that could set `indicator`
      // independently of `capturing` could ship a quiet mode, and a quiet
      // capture is the failure this file exists to make unwritable.
      throw new Error(
        `tray state ${name} may not declare an indicator — declare \`capturing: true\` and the indicator follows`,
      );
    }
  }

  /** The states in which the indicator is on. Exported so a test can sweep them. */
  const capturingStates = names.filter((name) => states[name].capturing === true);

  /**
   * @param {{ state: string } & Record<string, any>} input
   * @returns {{ state: string, title: string, tooltip: string, icon: string, indicator: boolean }}
   */
  function present(input) {
    const state = states[input.state];
    if (!state) throw new Error(`unknown tray state ${JSON.stringify(input.state)}`);
    const suffix = definition.suffix ? definition.suffix(input) : "";
    return {
      state: input.state,
      title: state.title ? state.title(input) : "",
      tooltip: `${state.tooltip(input)}${suffix}`,
      icon: state.icon,
      // Derived, never declared. See the header.
      indicator: state.capturing === true,
    };
  }

  return { present, states: names, capturingStates };
}
