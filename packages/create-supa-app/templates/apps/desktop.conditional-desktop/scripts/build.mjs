/**
 * One esbuild pass over the three worlds this app has: the Node main process
 * (ESM, `electron` external), the preload (**CommonJS** — Electron `require`s
 * preloads, and an ESM preload silently does nothing), and the renderer
 * (browser ESM). All three settings live in `@supa-media/desktop/build`.
 *
 * `--watch` rebuilds on change; run `pnpm start` in another terminal.
 */

import { buildDesktop } from "@supa-media/desktop/build";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

await buildDesktop({
  root: dirname(dirname(fileURLToPath(import.meta.url))),
  main: "src/main/index.js",
  preloads: { "preload.js": "src/preload/index.js" },
  renderers: { "panel.js": "src/renderer/panel.js" },
  static: ["src/renderer/panel.html", "src/renderer/panel.css"],
  watch: process.argv.includes("--watch"),
});
