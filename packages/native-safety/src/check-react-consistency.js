#!/usr/bin/env node
/**
 * CI enforcement: keep an Expo/React-Native app's native React graph healthy.
 * Two gates, ported unchanged (detection logic) from Togather's
 * apps/mobile/scripts/check-react-consistency.js — see the postmortem in
 * Togather's docs/architecture/ADR-013-mobile-versioning-and-ota-updates.md.
 *
 *   1. Single-React check — no second/mismatched React in the native module
 *      graph (see the long note below).
 *   2. Native-unsafe dependency denylist — the app must not depend on
 *      emotion / CSS-in-JS / MUI libraries, which reshape the app's
 *      React/module graph and break native Fabric rendering even when they are
 *      only imported on web (this is the mechanism behind gate #1's failure).
 *
 * Both gates run every time; the script exits 1 if EITHER fails, and prints a
 * combined OK line only when BOTH pass.
 *
 * Why this exists
 * ---------------
 * An Expo app pins `react` to the exact version baked into the installed
 * native binary (the app's package.json -> dependencies.react, e.g. 19.1.0).
 * Expo/React-Native native modules (expo-modules-core, react-native, the
 * expo-* / @react-native/* packages, etc.) register Fabric views/modules
 * against that React. If a SECOND React sneaks into the shared pnpm lockfile
 * and re-keys those native packages (e.g.
 * `/expo-modules-core@3.0.29(react-native@0.81.5)(react@19.2.7)` instead of
 * `(react@19.1.0)`), Fabric view/module registration breaks AT RUNTIME on the
 * native binary — native video and animated GIFs render blank — while
 * typecheck, tests and the JS bundle all pass (tests mock native modules; JS
 * bundles fine). That is exactly the regression Togather's PR #548 shipped:
 * adding @mui/* + @emotion/* for a web datepicker made pnpm's
 * autoInstallPeers pull a second React into the graph.
 *
 * What this checks
 * ----------------
 * Reads the workspace-root pnpm-lock.yaml, finds every Expo/React-Native
 * native package entry, and collects the set of `(react@X)` peer versions
 * keyed onto them. That set must be EXACTLY {PINNED}, where PINNED is the
 * `react` specifier from the app's package.json. Any native package keyed to
 * a different React fails the check.
 *
 * `react-native-web` is intentionally excluded: it is the browser render shim
 * (runs on web, not on the native binary), and it legitimately rides the web
 * React (e.g. 19.2.4). Only React versions keyed onto packages that run on
 * the NATIVE binary matter here.
 *
 * Usage:
 *   npx @supa-media/native-safety check-react-consistency --pkg apps/mobile/package.json --lockfile pnpm-lock.yaml
 *   check-react-consistency --pkg apps/mobile/package.json --lockfile pnpm-lock.yaml --config apps/mobile/native-deps.json
 *   check-react-consistency --pkg apps/mobile/package.json --lockfile pnpm-lock.yaml --denylist react-datepicker,@ant-design/
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    pkg: null,
    lockfile: null,
    config: null,
    denylist: [],
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--pkg":
        args.pkg = argv[++i];
        break;
      case "--lockfile":
        args.lockfile = argv[++i];
        break;
      case "--config":
        args.config = argv[++i];
        break;
      case "--denylist":
        args.denylist = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  return args;
}

function printUsage() {
  console.log(`
Usage: check-react-consistency [options]

Options:
  --pkg <path>          Path to the app's package.json, whose dependencies.react
                         is the pinned version (required)
  --lockfile <path>      Path to the workspace-root pnpm-lock.yaml (required)
  --config <path>        Path to native-deps.json ({ core, gated } package name
                          lists) — used to catch scoped native packages the
                          name-prefix heuristic can't express (e.g.
                          @react-native-community/datetimepicker,
                          @gorhom/bottom-sheet). Its optional
                          "nativeUnsafeDenylist" array extends the default
                          web-lib denylist (gate #2).
  --denylist <names>     Comma-separated additional native-unsafe package
                          names/prefixes (e.g. "react-datepicker,@ant-design/")
                          to extend the default denylist for gate #2.
  --help, -h              Show this help message

Examples:
  check-react-consistency --pkg apps/mobile/package.json --lockfile pnpm-lock.yaml
  check-react-consistency --pkg apps/mobile/package.json --lockfile pnpm-lock.yaml --config apps/mobile/native-deps.json
`);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Authoritative set of native package NAMES from native-deps.json (core +
 * gated). This covers scoped native packages the NATIVE_PREFIX regex can't
 * express — e.g. @react-native-community/datetimepicker, @react-native-picker/
 * picker, @gorhom/bottom-sheet, @shopify/flash-list, @sentry/react-native — so
 * a second React re-keying any of them is also caught.
 *
 * Also returns any `nativeUnsafeDenylist` array in the config, which extends
 * the default web-lib denylist (gate #2).
 */
function loadConfig(configPath) {
  if (!configPath) return { nativeDepNames: new Set(), denylistExtra: [] };
  try {
    const nd = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      nativeDepNames: new Set([...(nd.core || []), ...(nd.gated || [])]),
      denylistExtra: nd.nativeUnsafeDenylist || [],
    };
  } catch {
    return { nativeDepNames: new Set(), denylistExtra: [] };
  }
}

/**
 * Package NAME prefixes that identify Expo/React-Native native packages —
 * the ones that register Fabric views/modules against React on the native
 * binary. Applied to the leading-slash lockfile key (e.g. "/expo-modules-core@...").
 */
const NATIVE_PREFIX = /^\/(@expo\/|@react-native\/|expo-|expo@|react-native-|react-native@)/;

/**
 * Native-prefixed packages that do NOT run on the native binary and so must be
 * exempt from the single-React rule. `react-native-web` is the web render shim
 * and legitimately rides the web React (e.g. 19.2.4).
 */
const EXCLUDED_NAMES = new Set(["react-native-web"]);

/** Extract the package name from a lockfile key like "/@expo/foo@1.2.3(peer@x):". */
function packageNameFromKey(key) {
  // key begins with "/"; strip it, then take the name up to the version "@".
  const body = key.slice(1);
  const m = body.match(/^(@[^/]+\/[^@]+|[^@]+)@/);
  return m ? m[1] : body;
}

/**
 * Default native-unsafe dependency denylist (Gate #2), taken from Togather's
 * battle-tested NATIVE_UNSAFE_DENYLIST.
 *
 * Each entry is a package-NAME prefix. Any package in the app's
 * `dependencies` or `devDependencies` whose name starts with one of these is a
 * hard failure. These are emotion / CSS-in-JS / MUI-family libraries: they pull
 * their own React (via pnpm's autoInstallPeers) and reshape the shared
 * React/module graph, which breaks native Fabric view/module registration —
 * native video and animated GIFs render blank on the installed binary — even
 * when the library is only ever imported on web. This is exactly what
 * Togather's PR #548 shipped (adding @mui/* + @emotion/* for a web
 * datepicker).
 *
 * `react-native-web` is intentionally NOT here: it is the legitimate web render
 * shim.
 *
 * Extend this list per-app via `--denylist` or a `nativeUnsafeDenylist` array
 * in native-deps.json — do not edit this default in place for an app-specific
 * addition.
 */
const DEFAULT_NATIVE_UNSAFE_DENYLIST = [
  "@mui/",
  "@emotion/",
  "@material-ui/",
  "styled-components",
];

/**
 * Gate #2: fail if the app depends on any native-unsafe (emotion/MUI/
 * CSS-in-JS) package. Returns true when clean, false when an offender is found.
 */
function checkNativeUnsafeDenylist(pkgJson, pkgLabel, denylist) {
  const allDeps = {
    ...(pkgJson.dependencies || {}),
    ...(pkgJson.devDependencies || {}),
  };

  const offenders = Object.keys(allDeps)
    .filter((name) =>
      denylist.some((prefix) =>
        prefix.endsWith("/") ? name.startsWith(prefix) : name === prefix || name.startsWith(prefix)
      )
    )
    .sort();

  if (offenders.length === 0) {
    console.log(
      `✅ Native-unsafe denylist check passed — no emotion/MUI/CSS-in-JS packages in ${pkgLabel}.`
    );
    return true;
  }

  console.error(
    `❌ Native-unsafe dependency in ${pkgLabel}.\n`
  );
  console.error("   These packages are on the native-unsafe denylist:\n");
  for (const name of offenders) {
    console.error(`   • ${name}  (${allDeps[name]})`);
  }
  console.error("");
  console.error(
    "   Why this is blocked: emotion / CSS-in-JS / MUI-family libraries pull"
  );
  console.error(
    "   their own React in via pnpm's autoInstallPeers and reshape the app's"
  );
  console.error(
    "   React/module graph. That breaks native Fabric view/module registration"
  );
  console.error(
    "   on the installed binary — native video and animated GIFs render blank —"
  );
  console.error(
    "   even when the library is imported ONLY on web. This is the exact"
  );
  console.error(
    "   class of regression Togather's PR #548 shipped (@mui/* + @emotion/*"
  );
  console.error("   added for a web datepicker).\n");
  console.error("   How to fix:");
  console.error(
    "     • Web-only date/UI needs should use a dependency-free approach or a"
  );
  console.error(
    "       library WITHOUT emotion (e.g. react-datepicker for a web datepicker)."
  );
  console.error(
    "     • If one of these packages is genuinely, unavoidably required, it must"
  );
  console.error(
    "       be justified in review and this denylist extended deliberately"
  );
  console.error(
    "       (via --denylist or native-deps.json's nativeUnsafeDenylist) — do not"
  );
  console.error(
    "       silently remove the guard.\n"
  );
  return false;
}

/** Gate #1: single React in the native graph. Returns true when clean. */
function checkReactConsistency(pkgJson, pkgLabel, lockfilePath, nativeDepNames) {
  // 1. Determine the pinned React version from the app's package.json.
  const pinned = pkgJson.dependencies && pkgJson.dependencies.react;
  if (!pinned) {
    console.error(
      `❌ Could not read dependencies.react from ${pkgLabel}`
    );
    process.exit(1);
  }

  // 2. Read the shared lockfile.
  if (!fs.existsSync(lockfilePath)) {
    console.error(`❌ Lockfile not found at ${lockfilePath}`);
    process.exit(1);
  }
  const lockLines = fs.readFileSync(lockfilePath, "utf-8").split("\n");

  // 3. Scan every package entry key. Package keys live at 2-space indent under
  //    `packages:` and look like `  /pkg@version(peerA@x)(peerB@y):`. The
  //    `(react@X)` we care about is a real react peer — the `(` must sit
  //    immediately before `react@`, which excludes `(@types/react@X)`.
  const offenders = []; // { name, key, react }
  const nativeReactVersions = new Set();

  for (const line of lockLines) {
    const keyMatch = line.match(/^ {2}(\/.+):$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];

    const name = packageNameFromKey(key);
    if (EXCLUDED_NAMES.has(name)) continue;

    // A package counts as native if its key matches the Expo/RN prefix OR its
    // name is classified native in native-deps.json (catches scoped packages
    // like @react-native-community/*, @gorhom/bottom-sheet, @shopify/flash-list).
    if (!NATIVE_PREFIX.test(key) && !nativeDepNames.has(name)) continue;

    // Real react peer only: "(" immediately before "react@" (not "@types/react@").
    const peerMatch = key.match(/\(react@([0-9][^)]*)\)/);
    if (!peerMatch) continue;

    const reactVersion = peerMatch[1];
    nativeReactVersions.add(reactVersion);
    if (reactVersion !== pinned) {
      offenders.push({ name, key, react: reactVersion });
    }
  }

  // 4. Assert the native-graph React set is exactly {PINNED}.
  if (offenders.length > 0) {
    console.error(
      "❌ Mismatched React version(s) in the NATIVE module graph.\n"
    );
    console.error(
      `   ${pkgLabel} pins react@${pinned} to match the installed native binary,`
    );
    console.error(
      "   but these Expo/React-Native native packages are keyed to a DIFFERENT React:\n"
    );
    for (const o of offenders) {
      console.error(`   • ${o.name}  ->  react@${o.react}`);
      console.error(`       ${o.key}`);
    }
    console.error("");
    console.error(
      `   A second/mismatched React (${[...nativeReactVersions]
        .filter((v) => v !== pinned)
        .join(", ")}) entered the native graph — almost always because a newly`
    );
    console.error(
      "   added React-based dependency (e.g. MUI / @emotion, or another web-only"
    );
    console.error(
      "   React lib) dragged its own React in via pnpm's autoInstallPeers, which"
    );
    console.error(
      "   then re-keyed the Expo native-module graph. On the installed native"
    );
    console.error(
      "   binary this breaks Fabric view/module registration (native video and"
    );
    console.error(
      "   animated GIFs render blank) even though typecheck, tests and the JS"
    );
    console.error(
      "   bundle all pass. This is the exact class of failure Togather's PR #548"
    );
    console.error("   shipped.\n");
    console.error("   How to fix:");
    console.error(
      "     1. Identify the newly added React-based dependency (check the PR's"
    );
    console.error(
      "        package.json diff) and remove or isolate it, OR"
    );
    console.error(
      `     2. Pin React in the workspace root package.json pnpm.overrides:`
    );
    console.error(
      `          "pnpm": { "overrides": { "react": "${pinned}", "react-dom": "${pinned}" } }`
    );
    console.error(
      "        then re-run `pnpm install` and commit the updated pnpm-lock.yaml.\n"
    );
    return false;
  }

  // Success.
  const versionsSeen =
    nativeReactVersions.size > 0 ? [...nativeReactVersions].join(", ") : pinned;
  console.log(
    `✅ React consistency check passed — native graph uses a single React (react@${versionsSeen}), matching the pinned react@${pinned}.`
  );
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  if (!args.pkg) {
    console.error("Error: --pkg is required. Pass the path to the app's package.json.");
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  if (!args.lockfile) {
    console.error("Error: --lockfile is required. Pass the path to the workspace-root pnpm-lock.yaml.");
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  const pkgPath = path.resolve(args.pkg);
  const lockfilePath = path.resolve(args.lockfile);
  const configPath = args.config ? path.resolve(args.config) : null;

  if (!fs.existsSync(pkgPath)) {
    console.error(`Error: package.json not found at ${pkgPath}`);
    process.exit(1);
  }

  const pkgLabel = path.relative(process.cwd(), pkgPath);
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  const { nativeDepNames, denylistExtra } = loadConfig(configPath);
  const denylist = [...DEFAULT_NATIVE_UNSAFE_DENYLIST, ...denylistExtra, ...args.denylist];

  // Run BOTH gates (don't short-circuit — report every failure in one pass).
  const reactOk = checkReactConsistency(pkgJson, pkgLabel, lockfilePath, nativeDepNames);
  const denylistOk = checkNativeUnsafeDenylist(pkgJson, pkgLabel, denylist);

  if (!reactOk || !denylistOk) {
    process.exit(1);
  }

  console.log(
    "\n✅ Native React graph OK — single React + no native-unsafe dependencies."
  );
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  checkReactConsistency,
  checkNativeUnsafeDenylist,
  packageNameFromKey,
  loadConfig,
  DEFAULT_NATIVE_UNSAFE_DENYLIST,
  NATIVE_PREFIX,
  EXCLUDED_NAMES,
};
