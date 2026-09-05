/**
 * The whole surface a window has, declared once and used from both sides.
 *
 * `contextIsolation` on, `nodeIntegration` off, and a **frozen object of named
 * functions** on `window` — that trio is standard advice, and the part people
 * skip is the third. A preload that exposes `invoke(channel, ...args)` has
 * handed the renderer the entire main process behind one function, and the
 * audit that would have caught it is now a search for every `invoke` call site
 * rather than a read of one declaration.
 *
 * So a bridge is declared as a list of **commands the renderer may send** and a
 * list of **channels it may be told about**, in one module that the preload and
 * the main process both import. The rule the shape encodes:
 *
 * > A renderer renders state and sends verbs. It cannot read a credential, it
 * > cannot reach the filesystem, and it cannot ask for anything that is not on
 * > this list.
 *
 * There is deliberately **no request/response** direction. A command is
 * fire-and-forget and the answer arrives as the next pushed state, so there is
 * no channel a renderer can call to *get* something — which is how "no
 * `getToken`" stays true without anybody having to remember it.
 *
 * @example
 * ```js
 * // shared/bridge.js
 * export const bridge = defineBridge({
 *   name: "app",
 *   channels: ["state"],
 *   commands: ["accept", "decline", "end", "setPreference"],
 * });
 *
 * // preload/index.js
 * bridge.expose();
 *
 * // main/index.js
 * bridge.handle({ accept: (episode) => …, end: () => … });
 * bridge.push([panel, main], "state", uiState());
 * ```
 */

import { contextBridge, ipcMain, ipcRenderer } from "electron";

/**
 * @param {object} definition
 * @param {string} definition.name the global the preload exposes, e.g. `"app"` → `window.app`
 * @param {readonly string[]} definition.channels main → renderer pushes
 * @param {readonly string[]} definition.commands renderer → main verbs
 */
export function defineBridge(definition) {
  const { name } = definition;
  if (!name || !/^[a-zA-Z_$][\w$]*$/.test(name)) {
    throw new Error(`defineBridge needs a valid identifier for its global, got ${JSON.stringify(name)}`);
  }
  const channels = [...(definition.channels ?? [])];
  const commands = [...(definition.commands ?? [])];
  const clash = commands.find((command) => channels.includes(command));
  if (clash) throw new Error(`${JSON.stringify(clash)} is both a channel and a command`);

  // Every name becomes a property on the frozen object a renderer holds, so a
  // name that is not an identifier produces an API only bracket notation can
  // reach — which works, looks wrong, and is discovered in a renderer rather
  // than here.
  for (const key of [...channels, ...commands]) {
    if (typeof key !== "string" || !/^[a-zA-Z_$][\w$]*$/.test(key)) {
      throw new Error(`bridge ${name}: ${JSON.stringify(key)} is not a valid identifier`);
    }
  }

  // Namespaced so two bridges in one app cannot collide, and so a stray
  // `ipcRenderer.send` from anywhere else does not land on a handler by
  // accident.
  const wire = (kind, key) => `${name}:${kind}:${key}`;

  /**
   * Preload side. Builds the frozen API object and puts it on `window[name]`.
   *
   * Each channel becomes `on<Channel>(handler)` and each command becomes a
   * function of the same name. The handler receives only the payload — the
   * `IpcRendererEvent` is dropped, because it carries a `sender` a renderer has
   * no business holding.
   */
  function expose() {
    const api = {};
    for (const channel of channels) {
      const method = `on${channel.charAt(0).toUpperCase()}${channel.slice(1)}`;
      api[method] = (handler) => {
        ipcRenderer.on(wire("push", channel), (_event, payload) => handler(payload));
      };
    }
    for (const command of commands) {
      api[command] = (...args) => ipcRenderer.send(wire("cmd", command), ...args);
    }
    contextBridge.exposeInMainWorld(name, Object.freeze(api));
    return api;
  }

  /**
   * Main side. Registers exactly one listener per declared command.
   *
   * A handler is required for every command: a declared verb with no handler is
   * a button that silently does nothing, which is the bug that gets reported as
   * "the app froze". The `event` is not passed on — a handler that needs to
   * know which window sent something is a design that should push state
   * instead.
   *
   * @param {Record<string, (...args: any[]) => void>} handlers
   */
  function handle(handlers) {
    const missing = commands.filter((command) => typeof handlers[command] !== "function");
    if (missing.length > 0) throw new Error(`bridge ${name} has no handler for: ${missing.join(", ")}`);
    const unknown = Object.keys(handlers).filter((key) => !commands.includes(key));
    if (unknown.length > 0) throw new Error(`bridge ${name} has handlers for undeclared commands: ${unknown.join(", ")}`);
    for (const command of commands) {
      ipcMain.removeAllListeners(wire("cmd", command));
      ipcMain.on(wire("cmd", command), (_event, ...args) => handlers[command](...args));
    }
  }

  /**
   * Push one channel's payload to every window that is still alive.
   *
   * @param {readonly import("electron").BrowserWindow[]} windows
   * @param {string} channel
   * @param {unknown} payload must be structured-cloneable, and must not contain a credential
   */
  function push(windows, channel, payload) {
    if (!channels.includes(channel)) throw new Error(`bridge ${name} has no channel ${JSON.stringify(channel)}`);
    for (const window of windows) {
      if (window && !window.isDestroyed()) window.webContents.send(wire("push", channel), payload);
    }
  }

  return { name, channels, commands, expose, handle, push, wire };
}
