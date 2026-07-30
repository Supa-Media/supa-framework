"use strict";

/**
 * Tests for check-ota-native-parity — the guard that refuses to publish an OTA
 * update whose native dependency versions disagree with the binary users have
 * installed.
 *
 * Regression origin: Togather shipped `expo-video` v3 JS over the air to a
 * binary built with v55 (see the ADR-013 postmortem there). The pure-function
 * tests below cover the comparison and EAS build-selection logic; the CLI tests
 * spawn the real binary against a REAL temporary git repository, because the
 * whole point of this check is that it reads the app's package.json out of git
 * history at the deployed build's commit.
 *
 * Uses Node's built-in test runner (`node --test`, Node >=22) — no extra deps.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync, execFileSync } = require("node:child_process");

const {
  collectNativeDeps,
  diffNativeDeps,
  selectDeployedBuilds,
  isNativePackage,
  loadConfig,
} = require("../src/check-ota-native-parity");

const CLI = path.join(__dirname, "..", "src", "check-ota-native-parity.js");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supa-ota-parity-"));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// isNativePackage / collectNativeDeps
// ---------------------------------------------------------------------------

test("isNativePackage matches expo/react-native families by name", () => {
  assert.equal(isNativePackage("expo-video"), true);
  assert.equal(isNativePackage("expo"), true);
  assert.equal(isNativePackage("react-native"), true);
  assert.equal(isNativePackage("react-native-webview"), true);
  assert.equal(isNativePackage("@expo/vector-icons"), true);

  assert.equal(isNativePackage("zod"), false);
  assert.equal(isNativePackage("date-fns"), false);
});

test("isNativePackage picks up scoped native packages listed in native-deps.json", () => {
  const names = new Set(["@gorhom/bottom-sheet"]);
  assert.equal(isNativePackage("@gorhom/bottom-sheet", names), true);
  // Without the config, an arbitrary scope isn't guessable from the name.
  assert.equal(isNativePackage("@acme/some-native-thing"), false);
  assert.equal(isNativePackage("@acme/some-native-thing", new Set(["@acme/some-native-thing"])), true);
});

test("collectNativeDeps takes runtime dependencies only, ignoring devDependencies", () => {
  const deps = collectNativeDeps({
    dependencies: { "expo-video": "^3.0.16", zod: "^3.23.8", react: "19.1.0" },
    // A native-looking devDependency must NOT gate a deploy: it isn't autolinked
    // into the binary, so moving it is not a native change.
    devDependencies: { "react-native-svg": "^15.0.0" },
  });

  assert.deepEqual(deps, { "expo-video": "^3.0.16" });
});

// ---------------------------------------------------------------------------
// diffNativeDeps
// ---------------------------------------------------------------------------

test("diffNativeDeps passes when the native versions are identical", () => {
  const deps = { "expo-video": "^55.0.11", "expo-audio": "^55.0.9" };
  const diff = diffNativeDeps(deps, { ...deps });

  assert.equal(diff.ok, true);
  assert.deepEqual(diff.changed, []);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
});

test("diffNativeDeps catches the exact Togather skew (expo-video v55 binary, v3 bundle)", () => {
  const diff = diffNativeDeps(
    { "expo-video": "^55.0.11", "expo-audio": "^55.0.9" },
    { "expo-video": "^3.0.16", "expo-audio": "^55.0.9" }
  );

  assert.equal(diff.ok, false);
  assert.deepEqual(diff.changed, [{ name: "expo-video", from: "^55.0.11", to: "^3.0.16" }]);
});

test("diffNativeDeps reports a native dep the binary does not contain at all", () => {
  const diff = diffNativeDeps({ expo: "~54.0.23" }, { expo: "~54.0.23", "expo-blur": "~15.0.8" });

  assert.equal(diff.ok, false);
  assert.deepEqual(diff.added, [{ name: "expo-blur", spec: "~15.0.8" }]);
  assert.deepEqual(diff.changed, []);
});

test("diffNativeDeps reports a native dep removed from the bundle but still linked", () => {
  const diff = diffNativeDeps({ expo: "~54.0.23", "expo-av": "^16.0.8" }, { expo: "~54.0.23" });

  assert.equal(diff.ok, false);
  assert.deepEqual(diff.removed, [{ name: "expo-av", spec: "^16.0.8" }]);
});

test("diffNativeDeps sorts findings by package name for stable output", () => {
  const diff = diffNativeDeps(
    { "expo-video": "1", "expo-audio": "1", "react-native-maps": "1" },
    { "expo-video": "2", "expo-audio": "2", "react-native-maps": "2" }
  );

  assert.deepEqual(
    diff.changed.map((c) => c.name),
    ["expo-audio", "expo-video", "react-native-maps"]
  );
});

// ---------------------------------------------------------------------------
// selectDeployedBuilds
// ---------------------------------------------------------------------------

const build = (over = {}) => ({
  id: "b1",
  status: "FINISHED",
  platform: "IOS",
  buildProfile: "production",
  gitCommitHash: "a".repeat(40),
  appVersion: "1.0.23",
  appBuildVersion: "32",
  completedAt: "2026-03-27T12:00:00.000Z",
  ...over,
});

test("selectDeployedBuilds picks the newest finished build per platform", () => {
  const selected = selectDeployedBuilds([
    build({ id: "old-ios", completedAt: "2026-03-01T00:00:00.000Z", gitCommitHash: "o".repeat(40) }),
    build({ id: "new-ios", completedAt: "2026-03-27T00:00:00.000Z", gitCommitHash: "n".repeat(40) }),
    build({ id: "android", platform: "ANDROID", gitCommitHash: "d".repeat(40) }),
  ]);

  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((b) => [b.platform, b.id]),
    [
      ["ANDROID", "android"],
      ["IOS", "new-ios"],
    ]
  );
});

test("selectDeployedBuilds ignores unfinished builds and other profiles", () => {
  const selected = selectDeployedBuilds([
    build({ id: "in-flight", status: "IN_PROGRESS", completedAt: "2026-07-30T00:00:00.000Z" }),
    build({ id: "errored", status: "ERRORED", completedAt: "2026-07-29T00:00:00.000Z" }),
    // A staging build is exactly what must NOT be trusted here: staging rebuilds
    // natively on every push, so it always "matches" and would mask the skew.
    build({ id: "staging", buildProfile: "staging", completedAt: "2026-07-28T00:00:00.000Z" }),
    build({ id: "real", completedAt: "2026-03-27T00:00:00.000Z" }),
  ]);

  assert.deepEqual(
    selected.map((b) => b.id),
    ["real"]
  );
});

test("selectDeployedBuilds can restrict to one platform", () => {
  const builds = [build({ id: "ios" }), build({ id: "android", platform: "ANDROID" })];

  assert.deepEqual(
    selectDeployedBuilds(builds, { platform: "android" }).map((b) => b.id),
    ["android"]
  );
});

test("selectDeployedBuilds rejects an unknown platform and a non-array payload", () => {
  assert.throws(() => selectDeployedBuilds([], { platform: "windows" }), /Unknown --platform/);
  assert.throws(() => selectDeployedBuilds({ builds: [] }), /must be an array/);
});

test("selectDeployedBuilds surfaces a missing commit hash rather than dropping the build", () => {
  const selected = selectDeployedBuilds([build({ gitCommitHash: undefined })]);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].commit, null);
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

test("loadConfig is permissive when no path is given, strict when a path is bad", () => {
  assert.deepEqual(loadConfig(null), { nativeDepNames: new Set() });
  assert.throws(() => loadConfig(path.join(tmpRoot, "nope.json")), /not found/);

  const bad = path.join(tmpRoot, "bad.json");
  fs.writeFileSync(bad, "{ not json");
  assert.throws(() => loadConfig(bad), /Could not parse/);
});

test("loadConfig merges core and gated native package names", () => {
  const p = path.join(tmpRoot, "native-deps.json");
  fs.writeFileSync(p, JSON.stringify({ core: ["expo"], gated: ["expo-video"] }));

  assert.deepEqual(loadConfig(p).nativeDepNames, new Set(["expo", "expo-video"]));
});

// ---------------------------------------------------------------------------
// CLI, against a real git repository
// ---------------------------------------------------------------------------

/**
 * Build a throwaway repo with two commits: a "build" commit (standing in for
 * the commit the deployed binary was compiled from) and HEAD.
 */
function makeRepo(name, buildDeps, headDeps) {
  const dir = path.join(tmpRoot, name);
  const appDir = path.join(dir, "apps", "mobile");
  fs.mkdirSync(appDir, { recursive: true });

  const g = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "test@example.com");
  g("config", "user.name", "Test");

  const pkgPath = path.join(appDir, "package.json");
  fs.writeFileSync(pkgPath, JSON.stringify({ name: "mobile", dependencies: buildDeps }, null, 2));
  g("add", "-A");
  g("commit", "-q", "-m", "build commit");
  const buildCommit = g("rev-parse", "HEAD").trim();

  fs.writeFileSync(pkgPath, JSON.stringify({ name: "mobile", dependencies: headDeps }, null, 2));
  g("add", "-A");
  // --allow-empty: the "unchanged deps" cases legitimately produce no diff, and
  // a distinct HEAD commit still matters (it proves the check reads the BUILD
  // commit's file, not just the working tree).
  g("commit", "-q", "--allow-empty", "-m", "head commit");

  return { dir, pkgPath, buildCommit };
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf-8" });
}

test("CLI exits 0 when the working tree matches the deployed build commit", () => {
  const deps = { "expo-video": "^55.0.11", zod: "^3.23.8" };
  const repo = makeRepo("match", deps, { ...deps, zod: "^3.24.0" }); // JS-only bump is fine

  const res = runCli(
    ["--pkg", "apps/mobile/package.json", "--build-commit", repo.buildCommit],
    repo.dir
  );

  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /OTA\/native parity OK/);
});

test("CLI exits 1 and names the skewed package when a native version moved", () => {
  const repo = makeRepo(
    "skew",
    { "expo-video": "^55.0.11", "expo-audio": "^55.0.9" },
    { "expo-video": "^3.0.16", "expo-audio": "^55.0.9" }
  );

  const res = runCli(
    ["--pkg", "apps/mobile/package.json", "--build-commit", repo.buildCommit],
    repo.dir
  );

  assert.equal(res.status, 1);
  assert.match(res.stderr, /OTA\/native parity FAILED/);
  assert.match(res.stderr, /expo-video: binary has \^55\.0\.11, this bundle ships \^3\.0\.16/);
  // expo-audio matched, so it must not be reported.
  assert.doesNotMatch(res.stderr, /expo-audio:/);
});

test("CLI derives the deployed commit from eas build:list JSON", () => {
  const repo = makeRepo(
    "eas-json",
    { "expo-video": "^55.0.11" },
    { "expo-video": "^3.0.16" }
  );
  const buildsPath = path.join(repo.dir, "builds.json");
  fs.writeFileSync(
    buildsPath,
    JSON.stringify([
      build({ id: "ios-prod", gitCommitHash: repo.buildCommit }),
      build({ id: "staging-newer", buildProfile: "staging", completedAt: "2026-07-30T00:00:00.000Z" }),
    ])
  );

  const res = runCli(
    [
      "--pkg",
      "apps/mobile/package.json",
      "--builds-json",
      "builds.json",
      "--platform",
      "ios",
    ],
    repo.dir
  );

  assert.equal(res.status, 1);
  assert.match(res.stderr, /1\.0\.23 \/ build 32/);
  assert.match(res.stderr, new RegExp(`built from commit ${repo.buildCommit}`));
});

test("CLI fails closed when no finished production build exists", () => {
  const deps = { "expo-video": "^55.0.11" };
  const repo = makeRepo("no-build", deps, deps);
  fs.writeFileSync(
    path.join(repo.dir, "builds.json"),
    JSON.stringify([build({ status: "IN_PROGRESS" })])
  );

  const res = runCli(
    ["--pkg", "apps/mobile/package.json", "--builds-json", "builds.json"],
    repo.dir
  );

  assert.equal(res.status, 1, "an unprovable deploy must not pass");
  assert.match(res.stderr, /No FINISHED "production" build found/);
});

test("CLI fails closed when the build has no commit hash recorded", () => {
  const deps = { "expo-video": "^55.0.11" };
  const repo = makeRepo("no-sha", deps, deps);
  fs.writeFileSync(
    path.join(repo.dir, "builds.json"),
    JSON.stringify([build({ gitCommitHash: null, platform: "IOS" })])
  );

  const res = runCli(
    ["--pkg", "apps/mobile/package.json", "--builds-json", "builds.json", "--platform", "ios"],
    repo.dir
  );

  assert.equal(res.status, 1);
  assert.match(res.stderr, /no gitCommitHash recorded/);
});

test("CLI fails closed when the deployed commit cannot be resolved locally", () => {
  const deps = { "expo-video": "^55.0.11" };
  const repo = makeRepo("missing-commit", deps, deps);

  const res = runCli(
    ["--pkg", "apps/mobile/package.json", "--build-commit", "f".repeat(40)],
    repo.dir
  );

  assert.equal(res.status, 1);
  assert.match(res.stderr, /could not be fetched/);
});

test("CLI checks EVERY platform's build, not just the first", () => {
  const repo = makeRepo(
    "both-platforms",
    { "expo-video": "^55.0.11" },
    { "expo-video": "^3.0.16" }
  );
  // iOS is stale (skewed); Android happens to be built from HEAD and matches.
  const headCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo.dir,
    encoding: "utf-8",
  }).trim();
  fs.writeFileSync(
    path.join(repo.dir, "builds.json"),
    JSON.stringify([
      build({ id: "ios", platform: "IOS", gitCommitHash: repo.buildCommit }),
      build({ id: "android", platform: "ANDROID", gitCommitHash: headCommit }),
    ])
  );

  const res = runCli(
    ["--pkg", "apps/mobile/package.json", "--builds-json", "builds.json", "--platform", "all"],
    repo.dir
  );

  assert.equal(res.status, 1, "a mismatch on any platform must fail the deploy");
  assert.match(res.stdout, /android/);
  assert.match(res.stderr, /ios/);
});

test("CLI requires a way to identify the deployed build", () => {
  const deps = { "expo-video": "^55.0.11" };
  const repo = makeRepo("no-target", deps, deps);

  const res = runCli(["--pkg", "apps/mobile/package.json"], repo.dir);

  assert.equal(res.status, 1);
  assert.match(res.stderr, /--build-commit .* or --builds-json/);
});
