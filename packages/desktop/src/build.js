/**
 * One esbuild pass over the three worlds an Electron app has.
 *
 * Electron will not run TypeScript and will not resolve a workspace package, so
 * something has to bundle. esbuild rather than a framework because there are
 * half a dozen entry points and no framework would be doing anything else — and
 * because the three worlds need three genuinely different settings, which is
 * the knowledge this module exists to hold:
 *
 *  - **main** — the Node side. ESM, and `electron` is **external**, because it
 *    is provided by the runtime and bundling it is a category error.
 *  - **preload** — **CommonJS, not ESM**. Electron `require`s preloads, and an
 *    ESM preload silently does nothing. That is the worst failure mode in the
 *    list, because the window still loads and still looks right and simply has
 *    no `window.app` on it, so it presents as a renderer bug.
 *  - **renderer** — the browser side. ESM, `platform: "browser"`, and no Node
 *    in it at all.
 *
 * HTML and CSS are copied rather than processed. They are hand-written and
 * small, and a pipeline over them is a build step nobody can read.
 *
 * @example
 * ```js
 * // apps/desktop/scripts/build.mjs
 * import { buildDesktop } from "@supa-media/desktop/build";
 *
 * await buildDesktop({
 *   root: new URL("..", import.meta.url).pathname,
 *   main: "src/main/index.ts",
 *   preloads: { "preload.js": "src/preload/index.ts" },
 *   renderers: { "panel.js": "src/renderer/panel.ts" },
 *   static: ["src/renderer/panel.html", "src/renderer/panel.css"],
 *   watch: process.argv.includes("--watch"),
 * });
 * ```
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

/**
 * Defaults pinned to what Electron 33 ships. Override both together when you
 * move Electron major versions — a Chromium target ahead of the runtime is a
 * renderer that throws on a syntax error, at run time, in a window.
 */
export const DEFAULT_TARGETS = Object.freeze({ node: "node20", chrome: "chrome128" });

const resolveIn = (root, path) => (isAbsolute(path) ? path : join(root, path));

/**
 * @param {object} options
 * @param {string} options.root the app directory; every relative path is resolved against it
 * @param {string} [options.outDir] defaults to `<root>/dist`
 * @param {string} options.main the main-process entry point
 * @param {Record<string, string>} [options.preloads] output filename → entry point
 * @param {Record<string, string>} [options.renderers] output filename → entry point
 * @param {readonly string[]} [options.static] files copied into the renderer directory as-is
 * @param {boolean} [options.watch]
 * @param {{ node?: string, chrome?: string }} [options.targets]
 * @param {readonly string[]} [options.external] extra packages to leave unbundled
 * @param {boolean} [options.sourcemap]
 * @param {boolean} [options.minify]
 * @param {{ build: Function, context: Function }} [options.esbuild] injected for tests
 */
export async function buildDesktop(options) {
  // Imported here rather than at module scope so that this file can be read,
  // typechecked and imported in an environment where esbuild is not installed —
  // it is an optional peer, and only building needs it. `options.esbuild` is
  // the injection seam: the settings below are the whole point of this module
  // and they are worth a check, so the suite passes in a recorder rather than
  // leaving the one line that decides whether preloads run at all untested.
  const esbuild =
    options.esbuild ??
    (await import("esbuild").catch(() => {
      throw new Error(
        "@supa-media/desktop/build needs esbuild — add it as a devDependency of your desktop app (it is an optional peer here)",
      );
    }));

  const { root } = options;
  if (!root) throw new Error("buildDesktop needs a root directory");
  const out = options.outDir ? resolveIn(root, options.outDir) : join(root, "dist");
  const targets = { ...DEFAULT_TARGETS, ...options.targets };
  const external = ["electron", ...(options.external ?? [])];

  const shared = {
    bundle: true,
    sourcemap: options.sourcemap !== false,
    minify: options.minify === true,
    logLevel: "info",
  };

  const configs = [
    {
      ...shared,
      entryPoints: [resolveIn(root, options.main)],
      outfile: join(out, "main/index.js"),
      platform: "node",
      format: "esm",
      target: targets.node,
      external,
    },
    ...Object.entries(options.preloads ?? {}).map(([name, entry]) => ({
      ...shared,
      entryPoints: [resolveIn(root, entry)],
      outfile: join(out, "renderer", name),
      platform: "node",
      // CommonJS. See the header — this is the line that decides whether the
      // preload runs at all.
      format: "cjs",
      target: targets.node,
      external,
    })),
    ...Object.entries(options.renderers ?? {}).map(([name, entry]) => ({
      ...shared,
      entryPoints: [resolveIn(root, entry)],
      outfile: join(out, "renderer", name),
      platform: "browser",
      format: "esm",
      target: targets.chrome,
    })),
  ];

  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "renderer"), { recursive: true });
  for (const file of options.static ?? []) {
    await cp(resolveIn(root, file), join(out, "renderer", basename(file)));
  }

  if (options.watch) {
    const contexts = await Promise.all(configs.map((config) => esbuild.context(config)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("watching — run `pnpm start` in another terminal");
    return { out, watching: contexts };
  }

  await Promise.all(configs.map((config) => esbuild.build(config)));
  return { out, watching: null };
}
