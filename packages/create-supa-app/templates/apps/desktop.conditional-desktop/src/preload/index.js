/**
 * The whole surface a window has: whatever `shared/bridge.js` declares, frozen,
 * on `window.desktop`.
 *
 * There is no generic `invoke`, no `require`, no filesystem, and nothing that
 * reads a credential. `contextIsolation` is on, `nodeIntegration` is off and the
 * window is sandboxed, so this object is the only thing that crosses — which
 * matters because a desktop renderer displays text the app collected from the
 * machine, and on a shared computer somebody else named those files.
 *
 * This file is bundled as **CommonJS**. Electron `require`s preloads; an ESM
 * preload silently does nothing, and the failure looks like a renderer bug.
 */

import { bridge } from "../shared/bridge.js";

bridge.expose();
