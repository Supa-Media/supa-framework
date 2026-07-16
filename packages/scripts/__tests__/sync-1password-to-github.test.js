"use strict";

/**
 * Regression tests for the prune-safety redesign of
 * sync-1password-to-github.sh (see the two-phase read/classify/apply model
 * documented in the script's header comment).
 *
 * The bug this guards against: `op read` exits 1 identically for "this
 * secret was intentionally deleted from 1Password" and "1Password couldn't
 * be reached right now" (auth failure, rate limit, network blip). The old
 * script swallowed the read failure (`2>/dev/null || true`) and treated an
 * empty result as "prune it" either way — so a transient 1Password error
 * could delete a real, in-use production GitHub secret. The fix retries
 * `op read`, then only prunes on a definitive "item/field not found" from
 * op; any other persistent failure aborts the whole run with zero writes.
 *
 * These tests drive the real script as a subprocess against stub `op`/`gh`
 * binaries on PATH (see fixtures/stub-bin/), so they exercise the actual
 * bash control flow — not a reimplementation of it — without touching real
 * 1Password or GitHub. Retries are sped up via SUPA_RETRY_BACKOFF_SECONDS=0
 * (the script reads this env var; see its header for the full list).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "src", "sync-1password-to-github.sh");
const STUB_BIN = path.join(__dirname, "fixtures", "stub-bin");

/** Creates a fresh temp dir with its own STUB_STATE_DIR and allowlist.json. */
function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "supa-sync-secrets-test-"));
  const stateDir = path.join(dir, "state");
  fs.mkdirSync(stateDir);
  return { dir, stateDir };
}

function writeAllowlist(dir, allowlist) {
  const file = path.join(dir, "allowlist.json");
  fs.writeFileSync(
    file,
    typeof allowlist === "string" ? allowlist : JSON.stringify(allowlist, null, 2),
  );
  return file;
}

/** Sets the stub op's behavior for one key: "ok" | "missing" | "missing-field" | "error" | "flaky:N". */
function setOpMode(stateDir, key, mode, value) {
  fs.writeFileSync(path.join(stateDir, `op-${key}.mode`), mode);
  if (value !== undefined) {
    fs.writeFileSync(path.join(stateDir, `op-${key}.value`), value);
  }
}

function readLog(stateDir, name) {
  const file = path.join(stateDir, name);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function runSync(stateDir, args) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${STUB_BIN}:${process.env.PATH}`,
      STUB_STATE_DIR: stateDir,
      OP_SERVICE_ACCOUNT_TOKEN: "stub-token",
      // Keep retries real (3 attempts) but instant, so the "persistent
      // failure" tests still exercise the actual retry loop without
      // spending real wall-clock time on backoff sleeps.
      SUPA_RETRY_BACKOFF_SECONDS: "0",
    },
  });
}

test("aborts with zero writes when op read fails persistently on an optional secret (the critical bug)", () => {
  const { dir, stateDir } = makeSandbox();
  const allowlist = writeAllowlist(dir, {
    required: ["GOOD_REQUIRED"],
    optional: ["FLAKY_OPTIONAL"],
  });
  setOpMode(stateDir, "GOOD_REQUIRED", "ok", "real-required-value");
  // Simulates a rate-limited/auth-failed op read on a secret that is, in
  // reality, still present in 1Password — the exact ambiguity the old
  // script collapsed into "prune it".
  setOpMode(stateDir, "FLAKY_OPTIONAL", "error");

  const result = runSync(stateDir, [
    "--vault", "TestVault",
    "--allowlist", allowlist,
    "--environment", "staging",
  ]);

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}\n${result.stderr}`);

  const ghCalls = readLog(stateDir, "gh-calls.log");
  assert.deepEqual(ghCalls, [], "no gh secret set/delete call should happen when any read is ambiguous");

  // The read was retried (not given up on after one failure) before being
  // classified as an error.
  const opCalls = readLog(stateDir, "op-calls.log").filter((l) => l.includes("FLAKY_OPTIONAL"));
  assert.ok(opCalls.length >= 2, `expected op read to retry FLAKY_OPTIONAL, only saw ${opCalls.length} call(s)`);

  assert.match(result.stdout, /ABORTED/);
  assert.match(result.stdout, /FLAKY_OPTIONAL/);
});

test("prunes a definitively-absent optional secret and succeeds", () => {
  const { dir, stateDir } = makeSandbox();
  const allowlist = writeAllowlist(dir, {
    optional: ["REMOVED_FROM_1PASSWORD"],
  });
  // op's real phrasing for "this item does not exist" — the one and only
  // signal that should trigger a prune.
  setOpMode(stateDir, "REMOVED_FROM_1PASSWORD", "missing");

  const result = runSync(stateDir, [
    "--vault", "TestVault",
    "--allowlist", allowlist,
    "--environment", "staging",
  ]);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stdout}\n${result.stderr}`);

  const ghCalls = readLog(stateDir, "gh-calls.log");
  assert.deepEqual(ghCalls, ["delete REMOVED_FROM_1PASSWORD staging"]);
});

test("aborts before any writes when a required secret is missing, even if other secrets read fine", () => {
  const { dir, stateDir } = makeSandbox();
  const allowlist = writeAllowlist(dir, {
    required: ["MISSING_REQUIRED"],
    optional: ["FINE_OPTIONAL"],
  });
  setOpMode(stateDir, "MISSING_REQUIRED", "missing");
  setOpMode(stateDir, "FINE_OPTIONAL", "ok", "some-value");

  const result = runSync(stateDir, [
    "--vault", "TestVault",
    "--allowlist", allowlist,
    "--environment", "staging",
  ]);

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}\n${result.stderr}`);

  const ghCalls = readLog(stateDir, "gh-calls.log");
  assert.deepEqual(
    ghCalls,
    [],
    "FINE_OPTIONAL must not be set even though it read fine — phase 2 never runs once a required secret is missing",
  );

  assert.match(result.stdout, /ABORTED/);
  assert.match(result.stdout, /MISSING_REQUIRED/);
});

test("fails clearly on a malformed/wrong-shape allowlist, before touching op or gh", () => {
  const { dir, stateDir } = makeSandbox();
  // Syntactically valid JSON, wrong shape: `required` must be an array of
  // strings, not a bare string. This is the exact typo the old script's
  // JSON-syntax-only check let through as a silently-empty bash array.
  const allowlist = writeAllowlist(dir, {
    required: "CONVEX_DEPLOY_KEY",
    optional: ["FINE_OPTIONAL"],
  });
  setOpMode(stateDir, "FINE_OPTIONAL", "ok", "some-value");

  const result = runSync(stateDir, [
    "--vault", "TestVault",
    "--allowlist", allowlist,
    "--environment", "staging",
  ]);

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /invalid shape/i);
  assert.match(result.stderr, /"required" must be an array of strings/);

  assert.deepEqual(readLog(stateDir, "op-calls.log"), [], "must not read any secret from an invalid allowlist");
  assert.deepEqual(readLog(stateDir, "gh-calls.log"), [], "must not write/delete anything from an invalid allowlist");
});

test("retries a transient op failure and succeeds once it clears up within the retry budget", () => {
  const { dir, stateDir } = makeSandbox();
  const allowlist = writeAllowlist(dir, {
    required: ["EVENTUALLY_OK"],
  });
  // Fails the first 2 reads (rate-limit-style), succeeds on the 3rd — the
  // default SUPA_RETRY_MAX_ATTEMPTS is 3, so this must just barely succeed.
  setOpMode(stateDir, "EVENTUALLY_OK", "flaky:2", "value-after-retry");

  const result = runSync(stateDir, [
    "--vault", "TestVault",
    "--allowlist", allowlist,
    "--environment", "staging",
  ]);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stdout}\n${result.stderr}`);

  const ghCalls = readLog(stateDir, "gh-calls.log");
  assert.deepEqual(ghCalls, ["set EVENTUALLY_OK staging value-after-retry"]);

  const opCalls = readLog(stateDir, "op-calls.log").filter((l) => l.includes("EVENTUALLY_OK"));
  assert.equal(opCalls.length, 3, "expected exactly 3 op read attempts (2 failures + 1 success)");
});
