"use strict";

/**
 * Thin wrappers around the `git` CLI. No git library dependency — this
 * package is zero-dependency by design (see packages/scripts/README.md).
 */

const { spawnSync } = require("child_process");

/** Runs `git <args>` in `cwd` and returns { ok, stdout, stderrOutput }. */
function run(cwd, args, encoding) {
  const result = spawnSync("git", args, { cwd, encoding: encoding || "utf8" });
  if (result.error) {
    throw new Error(`git ${args.join(" ")} failed to run: ${result.error.message}`);
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.status === 0 ? "" : String(result.stderr || ""),
  };
}

/** Lists every git-tracked file in `cwd`, relative paths, posix-style. */
function listTrackedFiles(cwd) {
  const result = run(cwd, ["ls-files"]);
  if (!result.ok) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout.split("\n").filter(Boolean);
}

/**
 * Reads `relPath` as it existed at `ref`, as a Buffer. Returns null if the
 * ref or the path at that ref does not exist.
 */
function readFileAtRef(cwd, ref, relPath) {
  const result = run(cwd, ["show", `${ref}:${relPath}`], "buffer");
  if (!result.ok) return null;
  return result.stdout;
}

/**
 * Reads and JSON-parses `relPath` at `ref`. Returns null if the file is
 * absent at that ref (a missing config is treated as an empty config by
 * callers). Throws if the ref itself cannot be resolved at all, or the
 * file exists but is not valid JSON.
 */
function readJsonAtRef(cwd, ref, relPath) {
  const buf = readFileAtRef(cwd, ref, relPath);
  if (buf === null) return null;
  return JSON.parse(buf.toString("utf8"));
}

/** True if `ref` resolves to a commit in `cwd`. */
function refExists(cwd, ref) {
  const result = run(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return result.ok;
}

/**
 * The commit a branch forked from `ref`: `git merge-base <ref> HEAD`. Returns
 * null when there is none (unrelated histories, a shallow clone that cannot
 * see it).
 */
function mergeBase(cwd, ref) {
  const result = run(cwd, ["merge-base", ref, "HEAD"]);
  if (!result.ok) return null;
  return result.stdout.trim() || null;
}

module.exports = { listTrackedFiles, readFileAtRef, readJsonAtRef, refExists, mergeBase };
