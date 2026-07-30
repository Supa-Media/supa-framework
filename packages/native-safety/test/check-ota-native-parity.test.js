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
  isNativeCandidate,
  classifyInstalled,
  makeClassifier,
  loadConfig,
} = require("../src/check-ota-native-parity");

const CLI = path.join(__dirname, "..", "src", "check-ota-native-parity.js");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supa-ota-parity-"));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// isNativePackage / collectNativeDeps
// ---------------------------------------------------------------------------

test("isNativeCandidate matches expo/react-native families by name", () => {
  assert.equal(isNativeCandidate("expo-video"), true);
  assert.equal(isNativeCandidate("expo"), true);
  assert.equal(isNativeCandidate("react-native"), true);
  assert.equal(isNativeCandidate("react-native-webview"), true);
  assert.equal(isNativeCandidate("@expo/vector-icons"), true);

  assert.equal(isNativeCandidate("zod"), false);
  assert.equal(isNativeCandidate("date-fns"), false);
});

test("isNativeCandidate picks up scoped native packages listed in native-deps.json", () => {
  const names = new Set(["@gorhom/bottom-sheet"]);
  assert.equal(isNativeCandidate("@gorhom/bottom-sheet", names), true);
  // Without the config, an arbitrary scope isn't guessable from the name.
  assert.equal(isNativeCandidate("@acme/some-native-thing"), false);
  assert.equal(isNativeCandidate("@acme/some-native-thing", new Set(["@acme/some-native-thing"])), true);
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
// classifyInstalled — nativeness by evidence on disk, not by package name
// ---------------------------------------------------------------------------

/** Fake an installed package under <root>/node_modules/<name>. */
function installFake(root, name, files = []) {
  const dir = path.join(root, "node_modules", ...name.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  for (const file of files) {
    const target = path.join(dir, file);
    if (file.endsWith("/")) fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "");
    }
  }
  return dir;
}

test("classifyInstalled proves a JS-only package is not native", () => {
  const app = path.join(tmpRoot, "classify-js");
  fs.mkdirSync(app, { recursive: true });
  // react-native-reorderable-list is the real-world case: named like a native
  // package, but pure Reanimated/Gesture-Handler JS — no ios/, android/, podspec.
  installFake(app, "react-native-reorderable-list", ["lib/index.js"]);

  assert.equal(classifyInstalled("react-native-reorderable-list", app), false);
});

test("classifyInstalled detects native code via ios/, android/, or a podspec", () => {
  const app = path.join(tmpRoot, "classify-native");
  fs.mkdirSync(app, { recursive: true });
  installFake(app, "pkg-ios", ["ios/"]);
  installFake(app, "pkg-android", ["android/"]);
  installFake(app, "pkg-podspec", ["PkgPodspec.podspec"]);
  installFake(app, "pkg-expo-module", ["expo-module.config.json"]);

  assert.equal(classifyInstalled("pkg-ios", app), true);
  assert.equal(classifyInstalled("pkg-android", app), true);
  assert.equal(classifyInstalled("pkg-podspec", app), true);
  assert.equal(classifyInstalled("pkg-expo-module", app), true);
});

test("classifyInstalled returns null for a package that isn't installed", () => {
  const app = path.join(tmpRoot, "classify-missing");
  fs.mkdirSync(app, { recursive: true });

  assert.equal(classifyInstalled("never-installed-anywhere", app), null);
});

test("diffNativeDeps exonerates proven JS-only packages but reports them", () => {
  const classify = (name) => (name === "react-native-reorderable-list" ? false : null);

  const diff = diffNativeDeps(
    { expo: "~54.0.23" },
    { expo: "~54.0.23", "react-native-reorderable-list": "^0.18.0" },
    { classify }
  );

  assert.equal(diff.ok, true, "a JS-only package must not block a deploy");
  assert.deepEqual(diff.added, []);
  // Reported, not silently dropped — a wrong classification must be visible.
  assert.deepEqual(diff.ignored, [{ name: "react-native-reorderable-list", spec: "^0.18.0" }]);
});

test("diffNativeDeps treats an unknown classification as native (fails closed)", () => {
  const diff = diffNativeDeps(
    { expo: "~54.0.23" },
    { expo: "~54.0.23", "expo-blur": "~15.0.8" },
    { classify: () => null }
  );

  assert.equal(diff.ok, false);
  assert.deepEqual(diff.added, [{ name: "expo-blur", spec: "~15.0.8" }]);
  assert.deepEqual(diff.ignored, []);
});

test("makeClassifier caches per name and tolerates a missing app dir", () => {
  const app = path.join(tmpRoot, "classify-cache");
  fs.mkdirSync(app, { recursive: true });
  installFake(app, "cached-native-pkg", ["ios/"]);

  const classify = makeClassifier(app);
  assert.equal(classify("cached-native-pkg"), true);
  assert.equal(classify("cached-native-pkg"), true);

  // No app dir at all -> everything unknown -> everything fails closed.
  assert.equal(makeClassifier(null)("cached-native-pkg"), null);
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

test("CLI passes when the only moved package is a proven JS-only one, and says so", () => {
  const repo = makeRepo(
    "js-only-added",
    { expo: "~54.0.23" },
    { expo: "~54.0.23", "react-native-reorderable-list": "^0.18.0" }
  );
  // Install it JS-only (no ios/, no android/, no podspec) next to the app's
  // package.json, which is where --app-dir defaults to.
  installFake(path.join(repo.dir, "apps", "mobile"), "react-native-reorderable-list", [
    "lib/index.js",
  ]);

  const res = runCli(
    ["--pkg", "apps/mobile/package.json", "--build-commit", repo.buildCommit],
    repo.dir
  );

  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /ignoring react-native-reorderable-list/);
  assert.match(res.stdout, /OTA\/native parity OK/);
});

test("CLI still fails on a real native package even when a JS-only one also moved", () => {
  const repo = makeRepo(
    "js-only-plus-skew",
    { expo: "~54.0.23", "expo-video": "^55.0.11" },
    { expo: "~54.0.23", "expo-video": "^3.0.16", "react-native-reorderable-list": "^0.18.0" }
  );
  const appDir = path.join(repo.dir, "apps", "mobile");
  installFake(appDir, "react-native-reorderable-list", ["lib/index.js"]);
  installFake(appDir, "expo-video", ["ios/"]);

  const res = runCli(
    ["--pkg", "apps/mobile/package.json", "--build-commit", repo.buildCommit],
    repo.dir
  );

  assert.equal(res.status, 1);
  assert.match(res.stderr, /expo-video: binary has \^55\.0\.11, this bundle ships \^3\.0\.16/);
  assert.doesNotMatch(res.stderr, /reorderable/);
});

test("CLI requires a way to identify the deployed build", () => {
  const deps = { "expo-video": "^55.0.11" };
  const repo = makeRepo("no-target", deps, deps);

  const res = runCli(["--pkg", "apps/mobile/package.json"], repo.dir);

  assert.equal(res.status, 1);
  assert.match(res.stderr, /--build-commit .* or --builds-json/);
});
