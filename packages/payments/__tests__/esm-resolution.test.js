"use strict";

/**
 * Regression test for extension-less ESM specifiers in the compiled dist
 * output (fix/core-esm-specifiers).
 *
 * `tsc` never rewrites relative import/export specifiers at emit time —
 * whatever a TS source file writes (with or without an extension) is what
 * ends up verbatim in dist/*.js. Node's ESM resolver — which is what
 * actually runs when a consumer loads `supa.config.ts` via `tsx/cjs`, or
 * when the compiled package is `import()`-ed directly — requires an
 * *exact*, extension-ful relative specifier. It does NOT fall back to
 * trying ".js" or "/index.js" the way CommonJS `require()` or a bundler
 * (Metro/webpack) does. An extension-less specifier such as
 * `from "./defineConfig"` therefore throws `ERR_MODULE_NOT_FOUND` at
 * runtime even though `tsc` compiles it without complaint and the JS
 * bundle resolves it fine too — this class of bug is invisible to
 * typecheck and to any bundler-based build/test.
 *
 * This test walks the built dist/ output and re-runs Node's own strict
 * ESM resolution algorithm statically: every relative import/export
 * specifier must resolve to a file that exists on disk exactly as written
 * (no directory-index or extension fallback).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DIST_DIR = path.join(__dirname, "..", "dist");

// Matches `from "..."` / `from '...'` and `import("...")` relative specifiers.
const SPECIFIER_RE = /(?:from\s+|import\(\s*)["'](\.\.?\/[^"']+)["']/g;
// Strips /* ... */ block comments (JSDoc @example snippets can contain
// relative-looking specifiers that aren't real imports) without shifting
// offsets, so line numbers in failures stay accurate.
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

function walkJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("dist output: every relative specifier resolves under strict Node ESM rules", () => {
  const files = walkJsFiles(DIST_DIR);
  assert.ok(files.length > 0, `expected built .js files under ${DIST_DIR} — did you run the build first?`);

  const failures = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf-8");
    const masked = raw.replace(BLOCK_COMMENT_RE, (m) => m.replace(/[^\n]/g, " "));

    let match;
    SPECIFIER_RE.lastIndex = 0;
    while ((match = SPECIFIER_RE.exec(masked))) {
      const specifier = match[1];
      const resolved = path.join(path.dirname(file), specifier);
      if (!fs.existsSync(resolved)) {
        failures.push(
          `${path.relative(DIST_DIR, file)}: specifier "${specifier}" does not resolve to an existing file ` +
            `(Node ESM requires the exact extension-ful path — add ".js" or "/index.js" to the source import)`,
        );
      }
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});
