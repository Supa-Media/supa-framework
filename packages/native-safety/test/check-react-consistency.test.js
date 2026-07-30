"use strict";

/**
 * Tests for check-react-consistency, ported from Togather's battle-tested
 * apps/mobile/scripts/check-react-consistency.js (see the ADR-013 postmortem
 * there). This is a static/lockfile check — it parses pnpm-lock.yaml text
 * directly, unlike @supa-media/testing's react-resolution guard, which walks
 * the actual installed node_modules layout at runtime.
 *
 * Uses Node's built-in test runner (`node --test`, Node >=22) — no extra deps.
 * Builds real package.json/pnpm-lock.yaml fixtures on disk in a temp dir, then
 * calls the exported check functions directly for the pure-function tests
 * below. The exported library functions (checkReactConsistency, loadConfig)
 * never call process.exit — on a fatal input error (missing
 * dependencies.react, missing lockfile, unreadable/unparseable --config) they
 * throw instead. Only the CLI entrypoint (main(), exercised via a real
 * subprocess spawn further down) catches those and owns exit codes.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const {
  checkReactConsistency,
  checkReactDomPairing,
  checkSingleNativeInstance,
  parsePackageDependencies,
  parseImporterVersions,
  parseImporterKeys,
  checkNativeUnsafeDenylist,
  packageNameFromKey,
  loadConfig,
  DEFAULT_NATIVE_UNSAFE_DENYLIST,
} = require("../src/check-react-consistency");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supa-react-consistency-"));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

function writeLockfile(dir, contents) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "pnpm-lock.yaml");
  fs.writeFileSync(p, contents);
  return p;
}

// Silence console output from the checks under test — we assert on return
// values, not printed text, and a passing test run shouldn't spam stdout.
function silence(fn) {
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

test("packageNameFromKey extracts scoped and unscoped package names", () => {
  assert.equal(packageNameFromKey("/react@19.1.0"), "react");
  assert.equal(
    packageNameFromKey("/@expo/vector-icons@14.0.0(react@19.1.0)"),
    "@expo/vector-icons"
  );
  assert.equal(
    packageNameFromKey("/expo-modules-core@3.0.29(react-native@0.81.5)(react@19.2.7)"),
    "expo-modules-core"
  );
});

test("checkReactConsistency passes when every native package is keyed to the pinned React", () => {
  const dir = path.join(tmpRoot, "healthy");
  const lockfilePath = writeLockfile(
    dir,
    [
      "packages:",
      "",
      "  /react@19.1.0:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /react-native@0.81.5(react@19.1.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /expo-modules-core@3.0.29(react-native@0.81.5)(react@19.1.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
      // react-native-web legitimately rides a different (web) React — must be excluded.
      "  /react-native-web@0.21.2(react@19.2.4):",
      "    resolution: {integrity: sha512-fake==}",
      "",
    ].join("\n")
  );
  const pkgJson = { dependencies: { react: "19.1.0", "react-native": "0.81.5" } };

  const ok = silence(() =>
    checkReactConsistency(pkgJson, "fixture/package.json", lockfilePath, new Set())
  );
  assert.equal(ok, true);
});

test("checkReactConsistency fails when a native package is keyed to a second React (the real hazard)", () => {
  const dir = path.join(tmpRoot, "dual-react");
  const lockfilePath = writeLockfile(
    dir,
    [
      "packages:",
      "",
      "  /react@19.1.0:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /react@19.2.7:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /react-native@0.81.5(react@19.1.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
      // re-keyed onto the second React — this is the #548-class hazard.
      "  /expo-modules-core@3.0.29(react-native@0.81.5)(react@19.2.7):",
      "    resolution: {integrity: sha512-fake==}",
      "",
    ].join("\n")
  );
  const pkgJson = { dependencies: { react: "19.1.0", "react-native": "0.81.5" } };

  const ok = silence(() =>
    checkReactConsistency(pkgJson, "fixture/package.json", lockfilePath, new Set())
  );
  assert.equal(ok, false);
});

test("checkReactConsistency catches scoped native packages via native-deps.json names, not just the prefix regex", () => {
  const dir = path.join(tmpRoot, "scoped-native");
  const lockfilePath = writeLockfile(
    dir,
    [
      "packages:",
      "",
      "  /react@19.1.0:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /react@19.2.7:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      // @gorhom/bottom-sheet doesn't match NATIVE_PREFIX (no expo-/react-native- prefix)
      // but IS a native package — only caught via the native-deps.json name set.
      "  /@gorhom/bottom-sheet@4.6.0(react@19.2.7):",
      "    resolution: {integrity: sha512-fake==}",
      "",
    ].join("\n")
  );
  const pkgJson = { dependencies: { react: "19.1.0" } };

  const okWithoutNames = silence(() =>
    checkReactConsistency(pkgJson, "fixture/package.json", lockfilePath, new Set())
  );
  assert.equal(okWithoutNames, true, "without native-deps names, the scoped package is invisible");

  const okWithNames = silence(() =>
    checkReactConsistency(
      pkgJson,
      "fixture/package.json",
      lockfilePath,
      new Set(["@gorhom/bottom-sheet"])
    )
  );
  assert.equal(okWithNames, false, "with native-deps names, the mismatch is caught");
});

test("checkReactDomPairing passes when every react-dom matches its keyed react — including multiple distinct (but internally matched) pairs", () => {
  const dir = path.join(tmpRoot, "paired-react-dom");
  const lockfilePath = writeLockfile(
    dir,
    [
      "packages:",
      "",
      "  /react@19.1.0:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /react@19.2.4:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      // Two react-doms is fine as long as each is keyed to its own version
      // (e.g. mobile subgraph on 19.1.0, web subgraph on 19.2.4).
      "  /react-dom@19.1.0(react@19.1.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /react-dom@19.2.4(react@19.2.4):",
      "    resolution: {integrity: sha512-fake==}",
      "",
    ].join("\n")
  );

  const ok = silence(() => checkReactDomPairing(lockfilePath));
  assert.equal(ok, true);
});

test("checkReactDomPairing fails on a skewed pair (the Togather verification-email incident)", () => {
  const dir = path.join(tmpRoot, "skewed-react-dom");
  const lockfilePath = writeLockfile(
    dir,
    [
      "packages:",
      "",
      "  /react@19.1.0:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      // react pinned to 19.1.0 in a workspace package, but react-dom
      // auto-installed as a transitive peer at 19.2.4 — react-dom/server
      // hard-errors at render time on this exact shape.
      "  /react-dom@19.2.4(react@19.1.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
    ].join("\n")
  );

  const ok = silence(() => checkReactDomPairing(lockfilePath));
  assert.equal(ok, false);
});

test("checkReactDomPairing ignores react-dom entries with no react peer key, and @types/react peers", () => {
  const dir = path.join(tmpRoot, "no-peer-react-dom");
  const lockfilePath = writeLockfile(
    dir,
    [
      "packages:",
      "",
      "  /react-dom@19.1.0:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /react-dom@19.1.0(@types/react@19.2.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
    ].join("\n")
  );

  const ok = silence(() => checkReactDomPairing(lockfilePath));
  assert.equal(ok, true);
});

test("checkReactDomPairing parses pnpm v9 snapshot keys (no leading slash) — a skewed pair must not pass silently", () => {
  const dir = path.join(tmpRoot, "v9-skewed-react-dom");
  const lockfilePath = writeLockfile(
    dir,
    [
      "lockfileVersion: '9.0'",
      "",
      "packages:",
      "",
      "  react-dom@19.2.4:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "snapshots:",
      "",
      "  react-dom@19.2.4(react@19.1.0):",
      "    dependencies:",
      "      react: 19.1.0",
      "",
    ].join("\n")
  );

  const ok = silence(() => checkReactDomPairing(lockfilePath));
  assert.equal(ok, false, "v9-format skewed pair must fail, not silently no-op");
});

test("checkReactDomPairing passes a matched pair in pnpm v9 snapshot format", () => {
  const dir = path.join(tmpRoot, "v9-matched-react-dom");
  const lockfilePath = writeLockfile(
    dir,
    [
      "lockfileVersion: '9.0'",
      "",
      "snapshots:",
      "",
      "  react-dom@19.1.0(react@19.1.0):",
      "    dependencies:",
      "      react: 19.1.0",
      "",
    ].join("\n")
  );

  const ok = silence(() => checkReactDomPairing(lockfilePath));
  assert.equal(ok, true);
});

test("checkReactDomPairing throws (does not process.exit) when the lockfile is missing", () => {
  const missingLockfile = path.join(tmpRoot, "no-such-dir-pairing", "pnpm-lock.yaml");
  assert.throws(
    () => silence(() => checkReactDomPairing(missingLockfile)),
    /Lockfile not found/
  );
});

test("checkNativeUnsafeDenylist passes with no denylisted packages", () => {
  const pkgJson = { dependencies: { react: "19.1.0", "react-native": "0.81.5" } };
  const ok = silence(() =>
    checkNativeUnsafeDenylist(pkgJson, "fixture/package.json", DEFAULT_NATIVE_UNSAFE_DENYLIST)
  );
  assert.equal(ok, true);
});

test("checkNativeUnsafeDenylist fails on MUI/emotion (the #548 regression)", () => {
  const pkgJson = {
    dependencies: { react: "19.1.0" },
    devDependencies: { "@mui/material": "5.15.0", "@emotion/react": "11.11.0" },
  };
  const ok = silence(() =>
    checkNativeUnsafeDenylist(pkgJson, "fixture/package.json", DEFAULT_NATIVE_UNSAFE_DENYLIST)
  );
  assert.equal(ok, false);
});

test("checkNativeUnsafeDenylist respects an app-specific extension to the default list", () => {
  const pkgJson = { dependencies: { react: "19.1.0", antd: "5.0.0" } };

  const okDefault = silence(() =>
    checkNativeUnsafeDenylist(pkgJson, "fixture/package.json", DEFAULT_NATIVE_UNSAFE_DENYLIST)
  );
  assert.equal(okDefault, true, "antd is not in the default denylist");

  const okExtended = silence(() =>
    checkNativeUnsafeDenylist(pkgJson, "fixture/package.json", [
      ...DEFAULT_NATIVE_UNSAFE_DENYLIST,
      "antd",
    ])
  );
  assert.equal(okExtended, false, "antd fails once added to the denylist");
});

test("loadConfig merges native-deps.json's core+gated names and nativeUnsafeDenylist extension", () => {
  const dir = path.join(tmpRoot, "config");
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "native-deps.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      core: ["react-native"],
      gated: ["@gorhom/bottom-sheet"],
      nativeUnsafeDenylist: ["antd"],
    })
  );

  const { nativeDepNames, denylistExtra } = loadConfig(configPath);
  assert.ok(nativeDepNames.has("react-native"));
  assert.ok(nativeDepNames.has("@gorhom/bottom-sheet"));
  assert.deepEqual(denylistExtra, ["antd"]);
});

test("loadConfig returns empty defaults when no config path is given", () => {
  const { nativeDepNames, denylistExtra } = loadConfig(null);
  assert.equal(nativeDepNames.size, 0);
  assert.deepEqual(denylistExtra, []);
});

test("loadConfig throws (does not silently degrade) when --config was explicitly passed but the file does not exist", () => {
  const missingPath = path.join(tmpRoot, "does-not-exist", "native-deps.json");
  assert.throws(() => loadConfig(missingPath), /Config file not found/);
});

test("loadConfig throws when --config was explicitly passed but fails to parse", () => {
  const dir = path.join(tmpRoot, "bad-config");
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "native-deps.json");
  fs.writeFileSync(configPath, "{ this is not valid json");

  assert.throws(() => loadConfig(configPath), /Could not parse config/);
});

test("checkReactConsistency throws (does not process.exit) when dependencies.react is missing — library functions never exit the host process", () => {
  const dir = path.join(tmpRoot, "no-react-dep");
  const lockfilePath = writeLockfile(dir, ["packages:", ""].join("\n"));
  const pkgJson = { dependencies: {} };

  assert.throws(
    () => silence(() => checkReactConsistency(pkgJson, "fixture/package.json", lockfilePath, new Set())),
    /Could not read dependencies\.react/
  );
});

test("checkReactConsistency throws (does not process.exit) when the lockfile is missing", () => {
  const pkgJson = { dependencies: { react: "19.1.0" } };
  const missingLockfile = path.join(tmpRoot, "no-such-dir", "pnpm-lock.yaml");

  assert.throws(
    () => silence(() => checkReactConsistency(pkgJson, "fixture/package.json", missingLockfile, new Set())),
    /Lockfile not found/
  );
});

// ---------------------------------------------------------------------------
// CLI entrypoint (main()) — real subprocess spawn, exercising parseArgs +
// main()'s wiring end-to-end, not just the exported library functions.
// ---------------------------------------------------------------------------

const CLI_PATH = path.join(__dirname, "..", "src", "check-react-consistency.js");

function writeHealthyFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const pkgPath = path.join(dir, "package.json");
  fs.writeFileSync(
    pkgPath,
    JSON.stringify({ dependencies: { react: "19.1.0", "react-native": "0.81.5" } })
  );
  const lockfilePath = writeLockfile(
    dir,
    [
      "packages:",
      "",
      "  /react@19.1.0:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /react-native@0.81.5(react@19.1.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
      // A correctly matched react-dom pair, so the happy-path CLI test
      // exercises gate #3 non-vacuously (not just "no react-dom present").
      "  /react-dom@19.1.0(react@19.1.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
    ].join("\n")
  );
  return { pkgPath, lockfilePath };
}

test("CLI: bad --config path (explicitly passed, does not exist) exits 1 with a clear error, not a silent green pass", () => {
  const dir = path.join(tmpRoot, "cli-bad-config");
  const { pkgPath, lockfilePath } = writeHealthyFixture(dir);
  const badConfigPath = path.join(dir, "does-not-exist.json");

  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "--pkg", pkgPath, "--lockfile", lockfilePath, "--config", badConfigPath],
    { encoding: "utf-8" }
  );

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}. stderr: ${result.stderr}`);
  assert.match(result.stderr, /Config file not found/);
  // Must NOT print the success banner — that would be the silent-degradation bug.
  assert.doesNotMatch(result.stdout, /Native React graph OK/);
});

test("CLI: happy path (no --config) passes all gates and exits 0", () => {
  const dir = path.join(tmpRoot, "cli-happy");
  const { pkgPath, lockfilePath } = writeHealthyFixture(dir);

  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "--pkg", pkgPath, "--lockfile", lockfilePath],
    { encoding: "utf-8" }
  );

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
  assert.match(result.stdout, /Native React graph OK/);
});

test("CLI: a skewed react-dom pair fails gate #3 and exits 1, even when the native graph itself is healthy", () => {
  const dir = path.join(tmpRoot, "cli-skewed-react-dom");
  fs.mkdirSync(dir, { recursive: true });
  const pkgPath = path.join(dir, "package.json");
  fs.writeFileSync(
    pkgPath,
    JSON.stringify({ dependencies: { react: "19.1.0", "react-native": "0.81.5" } })
  );
  const lockfilePath = writeLockfile(
    dir,
    [
      "packages:",
      "",
      "  /react@19.1.0:",
      "    resolution: {integrity: sha512-fake==}",
      "",
      "  /react-native@0.81.5(react@19.1.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
      // Native graph is fine (gate #1 passes) — the ONLY problem is the pair.
      "  /react-dom@19.2.4(react@19.1.0):",
      "    resolution: {integrity: sha512-fake==}",
      "",
    ].join("\n")
  );

  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "--pkg", pkgPath, "--lockfile", lockfilePath],
    { encoding: "utf-8" }
  );

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}. stdout: ${result.stdout}`);
  assert.match(result.stderr, /react-dom \/ react version skew/);
  assert.doesNotMatch(result.stdout, /Native React graph OK/);
});

// ---------------------------------------------------------------------------
// Gate #4: single native INSTANCE
// ---------------------------------------------------------------------------

/**
 * Regression origin: Togather's video/GIF break of 2026-07 (the SECOND one).
 * A dev-assistant dependency bump re-resolved the workspace and flipped
 * expo-modules-core & friends onto a second react-native instance that was
 * peer-keyed to the SAME react version, so gate #1 stayed green while two
 * physical react-native copies split the Fabric registry.
 */

const APP_RN = "0.81.5(@babel/core@7.29.0)(@types/react@19.1.17)(react@19.1.0)";
const ROOT_RN = "0.81.5(@babel/core@7.29.0)(react@19.1.0)";

/** Lockfile with two react-native instances; `emcRn` picks which one expo-modules-core uses. */
function twoInstanceLockfile(emcRn) {
  return `lockfileVersion: '6.0'

importers:

  apps/mobile:
    dependencies:
      react:
        specifier: 19.1.0
        version: 19.1.0
      react-native:
        specifier: 0.81.5
        version: ${APP_RN}

  .:
    dependencies:
      react-native:
        specifier: 0.81.5
        version: ${ROOT_RN}

packages:

  /react-native@${APP_RN}:
    resolution: {integrity: sha512-aaa}
    dependencies:
      react: 19.1.0
    dev: false

  /react-native@${ROOT_RN}:
    resolution: {integrity: sha512-bbb}
    dependencies:
      react: 19.1.0
    dev: false

  /expo-modules-core@3.0.29(react-native@0.81.5)(react@19.1.0):
    resolution: {integrity: sha512-ccc}
    peerDependencies:
      react-native: '*'
    dependencies:
      react-native: ${emcRn}
    dev: false

  /expo-video@3.0.16(react-native@0.81.5)(react@19.1.0):
    resolution: {integrity: sha512-ddd}
    peerDependencies:
      react-native: '*'
    dependencies:
      react-native: ${APP_RN}
    dev: false

  /@react-native/virtualized-lists@0.81.5(react-native@0.81.5)(react@19.1.0):
    resolution: {integrity: sha512-eee}
    dependencies:
      react-native: ${ROOT_RN}
    dev: false

  /@react-native/virtualized-lists@0.81.5(@types/react@19.1.17)(react-native@0.81.5)(react@19.1.0):
    resolution: {integrity: sha512-fff}
    dependencies:
      react-native: ${APP_RN}
    dev: false
`;
}

test("gate #4 passes when every shared native package uses the app's instance", () => {
  const lockfilePath = writeLockfile(
    path.join(tmpRoot, "instance-ok"),
    twoInstanceLockfile(APP_RN)
  );

  assert.equal(checkSingleNativeInstance(lockfilePath, new Set(), "apps/mobile"), true);
});

test("gate #4 fails when expo-modules-core is re-keyed onto the other instance", () => {
  const lockfilePath = writeLockfile(
    path.join(tmpRoot, "instance-split"),
    twoInstanceLockfile(ROOT_RN)
  );

  assert.equal(checkSingleNativeInstance(lockfilePath, new Set(), "apps/mobile"), false);
});

test("gate #4 does NOT fire on per-family copies of a multi-copy package", () => {
  // @react-native/virtualized-lists exists twice — one copy per react-native
  // instance — and each correctly points at its own family's runtime. Demanding
  // both match the app would be a false positive on a healthy graph.
  const lockfilePath = writeLockfile(
    path.join(tmpRoot, "instance-multicopy"),
    twoInstanceLockfile(APP_RN)
  );

  assert.equal(checkSingleNativeInstance(lockfilePath, new Set(), "apps/mobile"), true);
});

test("gate #4 is blind-spot-free where gate #1 is blind: same react, different instance", () => {
  // The whole point: both instances are keyed (react@19.1.0), so the
  // React-version set is a clean {pinned} and gate #1 passes on BOTH lockfiles.
  const good = writeLockfile(path.join(tmpRoot, "blind-good"), twoInstanceLockfile(APP_RN));
  const bad = writeLockfile(path.join(tmpRoot, "blind-bad"), twoInstanceLockfile(ROOT_RN));
  const pkgJson = { dependencies: { react: "19.1.0", "react-native": "0.81.5" } };

  assert.equal(checkReactConsistency(pkgJson, "apps/mobile/package.json", good, new Set()), true);
  assert.equal(checkReactConsistency(pkgJson, "apps/mobile/package.json", bad, new Set()), true);

  // Gate #4 is what separates them.
  assert.equal(checkSingleNativeInstance(good, new Set(), "apps/mobile"), true);
  assert.equal(checkSingleNativeInstance(bad, new Set(), "apps/mobile"), false);
});

test("gate #4 throws (never silently passes) when the importer isn't in the lockfile", () => {
  const lockfilePath = writeLockfile(
    path.join(tmpRoot, "instance-no-importer"),
    twoInstanceLockfile(APP_RN)
  );

  assert.throws(
    () => checkSingleNativeInstance(lockfilePath, new Set(), "apps/does-not-exist"),
    /not in pnpm-lock\.yaml.*Available/s
  );
});

test("gate #4 is n/a for an importer with no react-native/expo", () => {
  const lockfilePath = writeLockfile(
    path.join(tmpRoot, "instance-non-native"),
    twoInstanceLockfile(APP_RN)
  );

  // "." declares react-native in this fixture, so use a fresh lockfile where a
  // real importer has neither runtime.
  const p = writeLockfile(
    path.join(tmpRoot, "instance-web-only"),
    `lockfileVersion: '6.0'

importers:

  apps/web:
    dependencies:
      react:
        specifier: 19.2.4
        version: 19.2.4

packages:

  /react@19.2.4:
    resolution: {integrity: sha512-zzz}
    dev: false
`
  );

  assert.equal(checkSingleNativeInstance(p, new Set(), "apps/web"), true);
  assert.ok(fs.existsSync(lockfilePath));
});

test("parseImporterVersions/parseImporterKeys read the importers block", () => {
  const lines = twoInstanceLockfile(APP_RN).split("\n");

  assert.deepEqual(parseImporterKeys(lines), new Set(["apps/mobile", "."]));
  assert.equal(parseImporterVersions(lines, "apps/mobile")["react-native"], APP_RN);
  assert.equal(parseImporterVersions(lines, ".")["react-native"], ROOT_RN);
});

test("parsePackageDependencies ignores peerDependencies ranges", () => {
  const entries = parsePackageDependencies(twoInstanceLockfile(ROOT_RN).split("\n"));
  const emc = entries.find((e) => e.key.startsWith("/expo-modules-core@"));

  // peerDependencies said `react-native: '*'`; only the real resolution counts.
  assert.equal(emc.deps["react-native"], ROOT_RN);
});

test("gate #4 is n/a for a non-workspace lockfile (no importers block)", () => {
  // pnpm writes top-level dependencies instead of `importers:` for a single
  // project. No per-app anchor exists, and no workspace root can introduce a
  // second instance — so this is genuinely n/a, unlike a WRONG importer name,
  // which throws.
  const p = writeLockfile(
    path.join(tmpRoot, "instance-no-workspace"),
    `lockfileVersion: '6.0'

dependencies:
  react-native:
    specifier: 0.81.5
    version: ${APP_RN}

packages:

  /react-native@${APP_RN}:
    resolution: {integrity: sha512-aaa}
    dev: false
`
  );

  assert.equal(checkSingleNativeInstance(p, new Set(), "."), true);
});
