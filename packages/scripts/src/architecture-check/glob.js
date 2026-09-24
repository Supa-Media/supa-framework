"use strict";

/**
 * A small, dependency-free glob matcher for `architecture.config.json`'s
 * `exclude` list. Supports the three tokens the config format needs:
 *
 *   `**` — any number of path segments (including zero)
 *   `*`  — any characters within a single path segment (no `/`)
 *   `?`  — a single character within a segment
 *
 * Paths are matched as posix-style relative paths (as `git ls-files`
 * prints them), so there is no drive-letter or backslash handling.
 */

/** Escapes a literal chunk of the pattern for use inside a RegExp. */
function escapeLiteral(chunk) {
  return chunk.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** Compiles one glob pattern into a RegExp anchored to the whole path. */
function compileGlob(pattern) {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // `**` — swallow an optional trailing slash so `**/foo` also matches
      // `foo` at the root, and match across any number of segments.
      re += "(?:.*)";
      i += 2;
      if (pattern[i] === "/") i += 1;
    } else if (ch === "*") {
      re += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      re += "[^/]";
      i += 1;
    } else {
      let literal = "";
      while (i < pattern.length && pattern[i] !== "*" && pattern[i] !== "?") {
        literal += pattern[i];
        i += 1;
      }
      re += escapeLiteral(literal);
    }
  }
  re += "$";
  return new RegExp(re);
}

const compiledCache = new Map();

function getCompiled(pattern) {
  let re = compiledCache.get(pattern);
  if (!re) {
    re = compileGlob(pattern);
    compiledCache.set(pattern, re);
  }
  return re;
}

/** True if `relPath` (posix-style, no leading `./`) matches `pattern`. */
function matchGlob(pattern, relPath) {
  return getCompiled(pattern).test(relPath);
}

/** True if `relPath` matches any pattern in `patterns`. */
function matchAny(patterns, relPath) {
  for (const pattern of patterns) {
    if (matchGlob(pattern, relPath)) return true;
  }
  return false;
}

module.exports = { matchGlob, matchAny };
