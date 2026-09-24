"use strict";

/**
 * Builds the current-tree scan: for every git-tracked, non-binary,
 * non-excluded file, its line count, longest line length, and whether the
 * config marks it `generated`.
 */

const fs = require("fs");
const path = require("path");
const { isBinary, countLines } = require("./lines");
const { matchAny } = require("./glob");

/**
 * @param {string} cwd
 * @param {string[]} trackedFiles - relative, posix-style paths
 * @param {{exclude: string[], generated: Array<{path: string}>}} cfg
 * @returns {{files: Object<string, {lineCount: number, maxLineLength: number, generated: boolean}>, skipped: {binary: string[], excluded: string[]}}}
 */
function scanRepo(cwd, trackedFiles, cfg) {
  const generatedPaths = new Set(cfg.generated.map((g) => g.path));
  const files = {};
  const skipped = { binary: [], excluded: [] };

  for (const relPath of trackedFiles) {
    if (matchAny(cfg.exclude, relPath)) {
      skipped.excluded.push(relPath);
      continue;
    }

    const absPath = path.join(cwd, relPath);
    let buf;
    try {
      buf = fs.readFileSync(absPath);
    } catch {
      // Gone from disk despite being tracked (e.g. a submodule gitlink, or
      // a case-sensitivity mismatch) — nothing to count.
      continue;
    }

    if (isBinary(buf)) {
      skipped.binary.push(relPath);
      continue;
    }

    const { lineCount, maxLineLength } = countLines(buf);
    files[relPath] = {
      lineCount,
      maxLineLength,
      generated: generatedPaths.has(relPath),
    };
  }

  return { files, skipped };
}

module.exports = { scanRepo };
