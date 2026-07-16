"use strict";

/**
 * Integration regression test mirroring the reported bug directly: a
 * consumer's `supa.config.ts` does `import { defineConfig } from
 * "@supa-media/core/config"`, which resolves (via this package's
 * package.json `exports["./config"]`) to `dist/config/index.js`. That file
 * re-exports from `./defineConfig` and `./loadConfig` — if those specifiers
 * are missing their ".js" extension, Node's ESM resolver throws
 * `ERR_MODULE_NOT_FOUND` the moment this subpath is imported (see
 * fix/core-esm-specifiers). This test performs a real dynamic `import()`
 * of the built `./config` entry point — the same resolution path a
 * consumer hits — and asserts it loads and exposes the expected exports.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");

test("dist/config/index.js: subpath entry point resolves and loads under Node ESM", async () => {
  const entry = pathToFileURL(
    path.join(__dirname, "..", "dist", "config", "index.js"),
  ).href;

  const mod = await import(entry);

  assert.equal(typeof mod.defineConfig, "function");
  assert.equal(typeof mod.loadConfig, "function");
});
