/**
 * The three worlds get three settings, and one of them is a trap.
 *
 * **A preload bundled as ESM silently does nothing.** Electron `require`s
 * preloads, so an ESM one leaves the window loading, looking right, and having
 * no bridge object on it — which presents as a renderer bug and is debugged in
 * the wrong file for an afternoon. There is no error, no warning, and nothing in
 * the build output to see. That is why `format: "cjs"` gets a check rather than
 * a comment.
 *
 * esbuild is an optional peer and is not installed here, so `buildDesktop`
 * takes it as an injectable and the checks below run a recorder. That records
 * the *configuration*, not the bundling — esbuild's own behaviour is esbuild's
 * problem. The last check is the honest bookend: with nothing injected and
 * nothing installed, it must say so rather than half-build.
 *
 * ## Sabotage record
 *
 *   preloads bundled as `esm`                                            1 failure
 *   `electron` dropped from `external` on every bundle                   3 failures
 *   renderers built with `platform: "node"`                              1 failure
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TARGETS, buildDesktop } from "../src/build.js";

const root = mkdtempSync(join(tmpdir(), "supa-desktop-build-"));
test.after(() => rmSync(root, { recursive: true, force: true }));
writeFileSync(join(root, "panel.html"), "<!doctype html><title>x</title>");

/** An esbuild stand-in that records the configuration it was handed. */
function recorder() {
  const builds = [];
  const contexts = [];
  return {
    builds,
    contexts,
    async build(config) {
      builds.push(config);
    },
    async context(config) {
      contexts.push(config);
      return { watch: async () => {} };
    },
  };
}

const options = (esbuild, extra = {}) => ({
  root,
  main: "src/main/index.js",
  preloads: { "preload.js": "src/preload/index.js", "capture.js": "src/preload/capture.js" },
  renderers: { "panel.js": "src/renderer/panel.js" },
  static: ["panel.html"],
  esbuild,
  ...extra,
});

const byOutfile = (configs, suffix) => configs.find((config) => config.outfile.endsWith(suffix));

test("the main bundle is ESM node with electron left to the runtime", async () => {
  const esbuild = recorder();
  await buildDesktop(options(esbuild));
  const main = byOutfile(esbuild.builds, "main/index.js");
  assert.equal(main.platform, "node");
  assert.equal(main.format, "esm");
  assert.equal(main.target, DEFAULT_TARGETS.node);
  // Bundling Electron is a category error: the runtime provides it.
  assert.ok(main.external.includes("electron"));
  assert.equal(main.bundle, true);
});

test("EVERY PRELOAD IS COMMONJS", async () => {
  const esbuild = recorder();
  await buildDesktop(options(esbuild));
  for (const name of ["preload.js", "capture.js"]) {
    const preload = byOutfile(esbuild.builds, name);
    assert.equal(preload.format, "cjs", `${name} must be CommonJS or the bridge never appears`);
    assert.equal(preload.platform, "node");
    assert.ok(preload.external.includes("electron"));
  }
});

test("renderers are browser ESM with no Node in them", async () => {
  const esbuild = recorder();
  await buildDesktop(options(esbuild));
  const renderer = byOutfile(esbuild.builds, "panel.js");
  assert.equal(renderer.platform, "browser");
  assert.equal(renderer.format, "esm");
  assert.equal(renderer.target, DEFAULT_TARGETS.chrome);
  assert.equal("external" in renderer, false, "a renderer has nothing to leave unbundled");
});

test("static files are copied into the renderer output, not processed", async () => {
  const esbuild = recorder();
  const { out } = await buildDesktop(options(esbuild));
  assert.equal(readFileSync(join(out, "renderer", "panel.html"), "utf8"), "<!doctype html><title>x</title>");
  assert.equal(
    esbuild.builds.some((config) => config.outfile.endsWith(".html")),
    false,
  );
});

test("targets are overridden together, and extra externals are additive", async () => {
  const esbuild = recorder();
  await buildDesktop(options(esbuild, { targets: { node: "node22", chrome: "chrome134" }, external: ["sharp"] }));
  assert.equal(byOutfile(esbuild.builds, "main/index.js").target, "node22");
  assert.equal(byOutfile(esbuild.builds, "panel.js").target, "chrome134");
  assert.deepEqual(byOutfile(esbuild.builds, "main/index.js").external, ["electron", "sharp"]);
});

test("watch mode opens contexts instead of building once", async () => {
  const esbuild = recorder();
  const result = await buildDesktop(options(esbuild, { watch: true }));
  assert.equal(esbuild.builds.length, 0);
  assert.equal(esbuild.contexts.length, 4, "main, two preloads, one renderer");
  assert.equal(result.watching.length, 4);
});

test("a missing root is an error before anything is deleted", async () => {
  await assert.rejects(() => buildDesktop({ main: "x.js", esbuild: recorder() }), /needs a root directory/);
});

test("with no esbuild anywhere, it says so rather than half-building", async () => {
  // The resolution is injected rather than left to the machine. This check
  // originally called `buildDesktop({ root, main })` and relied on esbuild
  // genuinely being absent from the workspace, which held until something else
  // here depended on it — at which point the check started building for real
  // and failed on a missing entry point, having never once exercised the
  // message it is named after.
  await assert.rejects(
    () =>
      buildDesktop({
        root,
        main: "src/main/index.js",
        loadEsbuild: () => Promise.reject(new Error("Cannot find package 'esbuild'")),
      }),
    /needs esbuild/,
  );
});
