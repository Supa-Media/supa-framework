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
 * calls the exported check functions directly (no subprocess spawn needed —
 * the functions only read from the paths passed in and never process.exit
 * except on missing --pkg/--lockfile args, which the CLI layer alone owns).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  checkReactConsistency,
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
