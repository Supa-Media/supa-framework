"use strict";

/**
 * Integration tests for `supa-architecture-check`, driven as a subprocess
 * against real temp git repos — exercising the actual `git ls-files` /
 * `git show` control flow, not a reimplementation of it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CLI = path.join(__dirname, "..", "src", "architecture-check", "cli.js");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-check-test-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  return dir;
}

function git(dir, args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function commitAll(dir, message) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

function writeLines(dir, relPath, lineCount, { trailingNewline = true } = {}) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const body = Array.from({ length: lineCount }, (_, i) => `// line ${i}`).join("\n");
  fs.writeFileSync(abs, trailingNewline ? body + "\n" : body);
}

function writeConfig(dir, config, relPath = "architecture.config.json") {
  fs.writeFileSync(path.join(dir, relPath), JSON.stringify(config, null, 2) + "\n");
}

function run(dir, args) {
  const result = spawnSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const DEFAULT_CONFIG = () => ({
  thresholds: { warn: 500, review: 700, max: 1000 },
  exclude: [],
  generated: [],
  reviewed: {},
  baseline: {},
});

test("a 1,001-line new file with no baseline entry fails", () => {
  const dir = makeRepo();
  writeLines(dir, "big.js", 1001);
  writeConfig(dir, DEFAULT_CONFIG());
  commitAll(dir, "init");

  const result = run(dir, []);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /big\.js.*exceeds max threshold/);
});

test("a 1,000-line file (exactly at max) passes", () => {
  const dir = makeRepo();
  writeLines(dir, "big.js", 1000);
  writeConfig(dir, DEFAULT_CONFIG());
  commitAll(dir, "init");

  const result = run(dir, []);
  assert.equal(result.status, 0);
});

test("legacy growth beyond its baseline allowance fails", () => {
  const dir = makeRepo();
  writeLines(dir, "big.js", 1600);
  const cfg = DEFAULT_CONFIG();
  cfg.baseline["big.js"] = 1500; // allowance lower than actual count
  writeConfig(dir, cfg);
  commitAll(dir, "init");

  const result = run(dir, []);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /grew past its baseline allowance/);
});

test("legacy shrink below its baseline allowance passes, with a warning", () => {
  const dir = makeRepo();
  writeLines(dir, "big.js", 1400);
  const cfg = DEFAULT_CONFIG();
  cfg.baseline["big.js"] = 1500; // allowance higher than actual count
  writeConfig(dir, cfg);
  commitAll(dir, "init");

  const result = run(dir, []);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /WARNING.*lower baseline to 1400/);
});

test("a stale baseline entry (file no longer over max) fails", () => {
  const dir = makeRepo();
  writeLines(dir, "small.js", 200);
  const cfg = DEFAULT_CONFIG();
  cfg.baseline["small.js"] = 1500;
  writeConfig(dir, cfg);
  commitAll(dir, "init");

  const result = run(dir, []);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /baseline entry is stale/);
});

test("renaming a baselined big file to a new path fails under --base", () => {
  const dir = makeRepo();
  writeLines(dir, "big.js", 1500);
  const cfg = DEFAULT_CONFIG();
  cfg.baseline["big.js"] = 1500;
  writeConfig(dir, cfg);
  const base = commitAll(dir, "base");

  git(dir, ["mv", "big.js", "renamed.js"]);
  const cfg2 = DEFAULT_CONFIG();
  cfg2.baseline["renamed.js"] = 1500;
  writeConfig(dir, cfg2);
  commitAll(dir, "rename");

  const result = run(dir, ["--base", base]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /renamed\.js.*new baseline entry not present at the base ref/);
});

test("inflating a baseline number under --base fails", () => {
  const dir = makeRepo();
  writeLines(dir, "big.js", 1500);
  const cfg = DEFAULT_CONFIG();
  cfg.baseline["big.js"] = 1500;
  writeConfig(dir, cfg);
  const base = commitAll(dir, "base");

  const cfg2 = DEFAULT_CONFIG();
  cfg2.baseline["big.js"] = 2000; // inflated, file itself unchanged
  writeConfig(dir, cfg2);
  commitAll(dir, "inflate");

  const result = run(dir, ["--base", base]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /baseline allowance raised from 1500 to 2000/);
});

test("adding a new baseline entry under --base fails", () => {
  const dir = makeRepo();
  writeLines(dir, "big.js", 1500);
  writeConfig(dir, DEFAULT_CONFIG());
  const base = commitAll(dir, "base");

  const cfg = DEFAULT_CONFIG();
  cfg.baseline["big.js"] = 1500; // newly exempted, wasn't in base config
  writeConfig(dir, cfg);
  commitAll(dir, "add baseline");

  const result = run(dir, ["--base", base]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /new baseline entry not present at the base ref/);
});

test("raising a threshold under --base fails", () => {
  const dir = makeRepo();
  writeConfig(dir, DEFAULT_CONFIG());
  const base = commitAll(dir, "base");

  const cfg = DEFAULT_CONFIG();
  cfg.thresholds.max = 2000;
  writeConfig(dir, cfg);
  commitAll(dir, "raise threshold");

  const result = run(dir, ["--base", base]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /thresholds\.max raised from 1000 to 2000/);
});

test("a new generated entry fails under --base without the flag, passes with it", () => {
  const dir = makeRepo();
  writeLines(dir, "data.min.js", 2000);
  writeConfig(dir, DEFAULT_CONFIG());
  const base = commitAll(dir, "base");

  const cfg = DEFAULT_CONFIG();
  cfg.generated.push({ path: "data.min.js", reason: "minified bundle", command: "npm run build" });
  writeConfig(dir, cfg);
  commitAll(dir, "generated");

  const withoutFlag = run(dir, ["--base", base]);
  assert.equal(withoutFlag.status, 1);
  assert.match(withoutFlag.stdout, /POLICY CHANGE: new generated entry/);

  const withFlag = run(dir, ["--base", base, "--allow-generated-change"]);
  assert.equal(withFlag.status, 0);
});

test("a new 750-line file without a reviewed entry fails under --base, passes with one", () => {
  const dir = makeRepo();
  writeConfig(dir, DEFAULT_CONFIG());
  const base = commitAll(dir, "base");

  writeLines(dir, "mid.js", 750);
  commitAll(dir, "add mid.js");

  const withoutReviewed = run(dir, ["--base", base]);
  assert.equal(withoutReviewed.status, 1);
  assert.match(withoutReviewed.stdout, /mid\.js.*is new or grew past the review threshold/);

  const cfg = DEFAULT_CONFIG();
  cfg.reviewed["mid.js"] = "Cohesive state machine; splitting would hurt readability.";
  writeConfig(dir, cfg);
  commitAll(dir, "add reviewed reason");

  const withReviewed = run(dir, ["--base", base]);
  assert.equal(withReviewed.status, 0);
});

test("binary files are skipped entirely", () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.from([0, 1, 2, 3, 0, 5, 6]));
  writeConfig(dir, DEFAULT_CONFIG());
  commitAll(dir, "init");

  const result = run(dir, []);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /blob\.bin/);
});

test("an approved generated file passes regardless of size", () => {
  const dir = makeRepo();
  writeLines(dir, "vendor.bundle.js", 5000);
  const cfg = DEFAULT_CONFIG();
  cfg.generated.push({ path: "vendor.bundle.js", reason: "bundled vendor code", command: "npm run build" });
  writeConfig(dir, cfg);
  commitAll(dir, "init");

  const result = run(dir, []);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /vendor\.bundle\.js/);
});

test("a valid extraction (file shrinks below max, baseline entry removed) passes", () => {
  const dir = makeRepo();
  writeLines(dir, "big.js", 1500);
  const cfg = DEFAULT_CONFIG();
  cfg.baseline["big.js"] = 1500;
  writeConfig(dir, cfg);
  const base = commitAll(dir, "base");

  writeLines(dir, "big.js", 400);
  writeConfig(dir, DEFAULT_CONFIG()); // baseline entry removed
  commitAll(dir, "extract");

  const result = run(dir, ["--base", base]);
  assert.equal(result.status, 0);
});

test("--init writes a config with defaults, lockfile-as-generated, and an over-max baseline", () => {
  const dir = makeRepo();
  writeLines(dir, "legacy.js", 1200);
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  commitAll(dir, "init");

  const result = run(dir, ["--init"]);
  assert.equal(result.status, 0);

  const written = JSON.parse(fs.readFileSync(path.join(dir, "architecture.config.json"), "utf8"));
  assert.deepEqual(written.thresholds, { warn: 500, review: 700, max: 1000 });
  assert.equal(written.generated.length, 1);
  assert.equal(written.generated[0].path, "pnpm-lock.yaml");
  assert.equal(written.baseline["legacy.js"], 1200);

  // Refuses to overwrite an existing config.
  const again = run(dir, ["--init"]);
  assert.equal(again.status, 1);
});

test("a config error (generated entry missing reason) is reported and fails", () => {
  const dir = makeRepo();
  writeLines(dir, "x.js", 10);
  const cfg = DEFAULT_CONFIG();
  cfg.generated.push({ path: "x.js", reason: "", command: "npm run build" });
  writeConfig(dir, cfg);
  commitAll(dir, "init");

  const result = run(dir, []);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing a non-empty "reason"/);
});

test("a generated or baseline entry for a nonexistent path is an error", () => {
  const dir = makeRepo();
  writeLines(dir, "x.js", 10);
  const cfg = DEFAULT_CONFIG();
  cfg.baseline["ghost.js"] = 1500;
  writeConfig(dir, cfg);
  commitAll(dir, "init");

  const result = run(dir, []);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ghost\.js.*does not exist/);
});
