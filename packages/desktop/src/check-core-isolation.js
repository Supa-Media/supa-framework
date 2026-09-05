#!/usr/bin/env node

/**
 * The guard that keeps `core/` testable.
 *
 * The reason a desktop app's logic can be checked in milliseconds without
 * Electron installed is that none of it imports Electron. That property is one
 * `import { dialog } from "electron"` away from being false, and the afternoon
 * it stops being true is the afternoon the suite stops running — at which point
 * nobody notices, because the tests that would have failed no longer start.
 *
 * So it is enforced rather than agreed. Point this at a directory that must
 * stay Electron-free and it reports every import of `electron` (static,
 * dynamic, or `require`) with the file and line, and exits non-zero.
 *
 *     npx check-core-isolation src/core
 *     npx check-core-isolation src/core src/shared --also electron-store,node:child_process
 *
 * It is a text scan, not a resolver: it does not need `node_modules` and does
 * not care whether the app builds. That is deliberate — a guard that only runs
 * after a successful install is a guard that is skipped exactly when a broken
 * install is what somebody is debugging.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * What a directory that must stay runnable under plain `node` may not import.
 *
 * `@supa-media/desktop/electron` is on the list beside `electron` itself
 * because it is a re-export of it: a core file reaching for `createJsonStore`
 * pulls in the whole runtime just as surely as one reaching for `app`, and the
 * first version of this check missed exactly that.
 */
const DEFAULT_FORBIDDEN = ["electron", "@supa-media/desktop/electron"];

const SOURCE_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", ".git", "coverage", ".turbo"]);

/**
 * Matches the three ways a module arrives: `from "x"`, `import("x")`, and
 * `require("x")`. Type-only imports are matched too and that is intentional —
 * `import type { BrowserWindow } from "electron"` is erased at build time and
 * is harmless at runtime, but it means a core file is describing itself in
 * Electron's vocabulary, which is how the dependency comes back.
 */
const SPECIFIER_RE = /(?:from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /(^|[^:"'`\\])\/\/[^\n]*/g;

function listSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...listSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Blank out comments without shifting offsets, so reported line numbers stay
 * accurate. A JSDoc `@example` block that mentions `from "electron"` is
 * documentation, not a dependency, and must not fail the check.
 */
function stripComments(source) {
  return source
    .replace(BLOCK_COMMENT_RE, (match) => match.replace(/[^\n]/g, " "))
    .replace(LINE_COMMENT_RE, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/**
 * @param {{ dirs: string[], forbidden?: readonly string[], cwd?: string }} config
 * @returns {{ ok: boolean, checked: number, violations: { file: string, line: number, specifier: string }[] }}
 */
export { DEFAULT_FORBIDDEN };

export function checkCoreIsolation(config) {
  const forbidden = new Set(config.forbidden ?? DEFAULT_FORBIDDEN);
  const cwd = config.cwd ?? process.cwd();
  const violations = [];
  let checked = 0;

  for (const dir of config.dirs) {
    let stats;
    try {
      stats = statSync(dir);
    } catch {
      throw new Error(`check-core-isolation: ${dir} does not exist`);
    }
    if (!stats.isDirectory()) throw new Error(`check-core-isolation: ${dir} is not a directory`);

    for (const file of listSourceFiles(dir)) {
      checked += 1;
      const source = stripComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(SPECIFIER_RE)) {
        const specifier = match[1];
        // A subpath counts: `electron/main` is still Electron.
        const root = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0];
        if (!forbidden.has(specifier) && !forbidden.has(root)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        violations.push({ file: relative(cwd, file), line, specifier });
      }
    }
  }

  return { ok: violations.length === 0, checked, violations };
}

function main(argv) {
  const dirs = [];
  let forbidden = [...DEFAULT_FORBIDDEN];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--also") {
      forbidden = [...forbidden, ...String(argv[i + 1] ?? "").split(",").filter(Boolean)];
      i += 1;
    } else {
      dirs.push(argv[i]);
    }
  }
  if (dirs.length === 0) dirs.push("src/core");

  const result = checkCoreIsolation({ dirs, forbidden });
  if (result.ok) {
    console.log(`check-core-isolation: ${result.checked} files clean (${dirs.join(", ")})`);
    return 0;
  }
  console.error(`check-core-isolation: ${result.violations.length} forbidden import(s)\n`);
  for (const violation of result.violations) {
    console.error(`  ${violation.file}:${violation.line}  imports "${violation.specifier}"`);
  }
  console.error(
    "\nThese modules must stay runnable under plain node. Move the Electron call into the main process and pass the result in.",
  );
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
