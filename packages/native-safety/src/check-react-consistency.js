#!/usr/bin/env node
/**
 * CI enforcement: keep an Expo/React-Native app's native React graph healthy.
 * Gates #1 and #2 were ported unchanged (detection logic) from Togather's
 * apps/mobile/scripts/check-react-consistency.js — see the postmortem in
 * Togather's docs/architecture/ADR-013-mobile-versioning-and-ota-updates.md.
 *
 *   1. Single-React check — no second/mismatched React in the native module
 *      graph (see the long note below).
 *   2. Native-unsafe dependency denylist — the app must not depend on
 *      emotion / CSS-in-JS / MUI libraries, which reshape the app's
 *      React/module graph and break native Fabric rendering even when they are
 *      only imported on web (this is the mechanism behind gate #1's failure).
 *   3. react-dom/react pairing — every react-dom instance in the lockfile must
 *      be peer-keyed to its own exact version of react. react-dom's server
 *      renderer hard-errors at runtime on any mismatch (React >= 19.2,
 *      ensureCorrectIsomorphicReactVersion), so a skewed pair is a landmine
 *      wherever react-dom actually renders — SSR, react-email templates in
 *      server functions, etc. — while typecheck and non-rendering tests pass.
 *   4. Single native instance — every native package must resolve the SAME
 *      react-native/expo instance. Two peer-keyed instances at the same React
 *      version (e.g. `(@types/react@19.1.17)(react@19.1.0)` vs plain
 *      `(react@19.1.0)`) put two physical copies in one bundle, which splits the
 *      Fabric view/module registry and breaks native video + animated GIFs.
 *      Gate #1 cannot see this — both are `(react@19.1.0)`.
 *
 * All gates run every time; the script exits 1 if ANY fails, and prints a
 * combined OK line only when ALL pass.
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
    importer: null,
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
      case "--importer":
        args.importer = argv[++i];
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
  --pkg <path>             Path to the app's package.json, whose dependencies.react
                            is the pinned version (required)
  --lockfile <path>        Path to the workspace-root pnpm-lock.yaml (required)
  --config <path>          Path to native-deps.json ({ core, gated } package name
                            lists) — used to catch scoped native packages the
                            name-prefix heuristic can't express (e.g.
                            @react-native-community/datetimepicker,
                            @gorhom/bottom-sheet). Its optional
                            "nativeUnsafeDenylist" array extends the default
                            web-lib denylist (gate #2). Exits 1 if this path is
                            explicitly passed but missing or unparseable.
  --importer <path>        Workspace-relative dir of the app in the lockfile's
                            importers map (e.g. "apps/mobile"), used by gate
                            #4 as the instance every shared native package must
                            match. Defaults to --pkg's dir relative to the
                            lockfile's dir; pass it explicitly when those aren't
                            in the same tree. Exits 1 if it isn't an importer.
  --denylist <names>       Comma-separated additional native-unsafe package
                            names/prefixes (e.g. "react-datepicker,@ant-design/")
                            to extend the default denylist for gate #2.
  --help, -h                Show this help message

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
 *
 * `configPath === null` means `--config` was never passed — that's
 * permissive by design (no scoped-package detection, no denylist extension).
 * But if `configPath` IS given and the file is missing or fails to parse,
 * that's a user-supplied path that silently can't do its job — throw so the
 * CLI fails loudly instead of quietly degrading to "no config" while still
 * printing a green banner.
 */
function loadConfig(configPath) {
  if (!configPath) return { nativeDepNames: new Set(), denylistExtra: [] };

  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    throw new Error(`Config file not found at ${configPath} (${err.code || err.message})`);
  }

  let nd;
  try {
    nd = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse config at ${configPath}: ${err.message}`);
  }

  return {
    nativeDepNames: new Set([...(nd.core || []), ...(nd.gated || [])]),
    denylistExtra: nd.nativeUnsafeDenylist || [],
  };
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
// ---------------------------------------------------------------------------
// Gate #4: the shared native runtime the app resolves must be the one every
//          SHARED native package resolves too
// ---------------------------------------------------------------------------

/**
 * Dependency names whose resolved instance decides who owns the Fabric
 * view/module registry. Two physical copies of these in one bundle means two
 * registries, and views registered into one are invisible to components
 * resolving through the other.
 */
const SHARED_NATIVE_RUNTIMES = ["react-native", "expo"];

/**
 * Parse `packages:` entries into { key, deps: { name: resolvedValue } }, reading
 * ONLY each entry's real `dependencies:` block — never `peerDependencies:`,
 * which holds ranges like `'*'` rather than resolutions.
 */
function parsePackageDependencies(lockLines) {
  const entries = [];
  let current = null;
  let section = null;

  for (const line of lockLines) {
    const keyMatch = line.match(/^ {2}(\/.+):$/);
    if (keyMatch) {
      current = { key: keyMatch[1], deps: {} };
      entries.push(current);
      section = null;
      continue;
    }
    if (!current) continue;

    const sectionMatch = line.match(/^ {4}(\w+):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    // Any other 4-space key (resolution:, dev:, engines: …) ends the section.
    if (/^ {4}\S/.test(line)) section = null;

    if (section === "dependencies") {
      const depMatch = line.match(/^ {6}('?[^':]+'?): (\S.*)$/);
      if (depMatch) current.deps[depMatch[1].replace(/'/g, "")] = depMatch[2];
    }
  }

  return entries;
}

/**
 * Read one importer's resolved dependency versions from the `importers:` block.
 * `importerPath` is the workspace-relative dir, e.g. "apps/mobile".
 */
function parseImporterKeys(lockLines) {
  const keys = new Set();
  let inImporters = false;

  for (const line of lockLines) {
    // Top-level keys sit at column 0; `importers:` opens the block and the next
    // one (`packages:`, or `dependencies:` in a non-workspace lockfile) closes it.
    const topLevel = line.match(/^(\S+):/);
    if (topLevel) {
      inImporters = topLevel[1] === "importers";
      continue;
    }
    if (!inImporters) continue;

    const m = line.match(/^ {2}(\S+):$/);
    if (m) keys.add(m[1]);
  }

  return keys;
}

function parseImporterVersions(lockLines, importerPath) {
  const out = {};
  let inImporters = false;
  let inTarget = false;
  let depName = null;

  for (const line of lockLines) {
    const topLevel = line.match(/^(\S+):/);
    if (topLevel) {
      inImporters = topLevel[1] === "importers";
      inTarget = false;
      depName = null;
      continue;
    }
    if (!inImporters) continue;

    const importerMatch = line.match(/^ {2}(\S+):$/);
    if (importerMatch) {
      inTarget = importerMatch[1] === importerPath;
      depName = null;
      continue;
    }
    if (!inTarget) continue;

    const nameMatch = line.match(/^ {6}'?([^':]+)'?:$/);
    if (nameMatch) {
      depName = nameMatch[1];
      continue;
    }
    const versionMatch = line.match(/^ {8}version: (\S.*)$/);
    if (versionMatch && depName) {
      out[depName] = versionMatch[1];
      depName = null;
    }
  }

  return out;
}

/**
 * Every SHARED native package must resolve the same react-native/expo instance
 * the app itself resolves.
 *
 * Why this is a separate gate from #1: a lockfile can legitimately hold two
 * peer-keyed instances of react-native at the SAME react version, e.g.
 *
 *   react-native@0.81.5(@babel/core@7.29.0)(@types/react@19.1.17)(react@19.1.0)  <- the app's
 *   react-native@0.81.5(@babel/core@7.29.0)(react@19.1.0)                        <- e.g. a workspace-root dep's
 *
 * Gate #1 sees a clean `{pinned}` React set either way, because both are keyed
 * `(react@19.1.0)`. The damage is done by WHICH instance the Expo native chain
 * points at: when a re-resolution flips `expo-modules-core` & friends onto the
 * other one, pnpm materialises two physical copies in one bundle, so
 * expo-modules-core registers views into its copy's registry while the app's
 * components look them up in the other. `requireNativeViewManager(...)` returns
 * undefined, native video falls back / renders blank, animated GIFs break — and
 * static images, which need no native view, keep working. Typecheck, tests and
 * bundling all stay green.
 *
 * Togather shipped exactly this: a dev-assistant dependency bump re-keyed nine
 * Expo blocks (expo-modules-core, expo-asset, expo-constants, expo-file-system,
 * expo-font, expo-keep-awake, @expo/devtools, @expo/metro-config,
 * @expo/prebuild-config) onto the root instance and broke native video + GIFs.
 *
 * Only SHARED packages — those with exactly ONE copy in the lockfile — are
 * checked. A package with several copies has one per instance family, and those
 * copies correctly point at their own family's runtime (the root's `expo` and
 * its `@react-native/virtualized-lists`, a second `@expo/cli`, …); demanding
 * they match the app would be a false positive, and a gate that fires on a
 * healthy graph is a gate someone switches off. A single-copy package, by
 * contrast, is shared by everything and can only register into one registry —
 * which had better be the app's.
 */
function checkSingleNativeInstance(lockfilePath, nativeDepNames, importerPath) {
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(`Lockfile not found at ${lockfilePath}`);
  }

  const lockLines = fs.readFileSync(lockfilePath, "utf-8").split("\n");
  const entries = parsePackageDependencies(lockLines);
  const importerKeys = parseImporterKeys(lockLines);

  if (importerKeys.size === 0) {
    // A lockfile with no `importers:` block isn't a workspace (pnpm writes
    // top-level dependencies instead), so there is no per-app instance to
    // anchor on and no second instance a workspace root could introduce.
    console.log(
      "✅ Native instance check n/a — lockfile has no importers block (not a pnpm workspace)."
    );
    return true;
  }

  if (!importerKeys.has(importerPath)) {
    // Never skip: an unresolvable anchor means the gate cannot do its job, and a
    // guard that quietly passes in that state is the hole it exists to close.
    throw new Error(
      `Importer "${importerPath}" is not in ${path.basename(lockfilePath)}. ` +
        `Pass --importer <workspace-relative dir>. Available: ${[...importerKeys].sort().join(", ")}`
    );
  }

  const appVersions = parseImporterVersions(lockLines, importerPath);

  const expected = {};
  for (const runtime of SHARED_NATIVE_RUNTIMES) {
    if (appVersions[runtime]) expected[runtime] = appVersions[runtime];
  }

  if (Object.keys(expected).length === 0) {
    // A real importer that genuinely has no react-native/expo isn't a native
    // app — there is no registry to split.
    console.log(
      `✅ Native instance check n/a — importer "${importerPath}" declares no react-native/expo.`
    );
    return true;
  }

  // Count copies per package NAME: multi-copy packages are per-family.
  const copies = new Map();
  for (const entry of entries) {
    const name = packageNameFromKey(entry.key);
    copies.set(name, (copies.get(name) || 0) + 1);
  }

  const offenders = []; // { key, runtime, actual }
  for (const entry of entries) {
    const name = packageNameFromKey(entry.key);
    if (EXCLUDED_NAMES.has(name)) continue;
    if (!NATIVE_PREFIX.test(entry.key) && !nativeDepNames.has(name)) continue;
    if (copies.get(name) !== 1) continue; // per-family copy, not shared

    for (const runtime of SHARED_NATIVE_RUNTIMES) {
      const actual = entry.deps[runtime];
      if (!actual || !expected[runtime]) continue;
      if (actual !== expected[runtime]) offenders.push({ key: entry.key, runtime, actual });
    }
  }

  if (offenders.length === 0) {
    console.log(
      "✅ Native instance check passed — every shared native package resolves the app's react-native/expo instance."
    );
    return true;
  }

  const byRuntime = new Map();
  for (const o of offenders) {
    if (!byRuntime.has(o.runtime)) byRuntime.set(o.runtime, []);
    byRuntime.get(o.runtime).push(o);
  }

  console.error(
    `\n❌ Split native graph — ${offenders.length} shared native package reference(s) resolve a different runtime instance than ${importerPath} does.`
  );
  console.error(
    "   pnpm will materialise two physical copies in one bundle, which means separate"
  );
  console.error(
    "   Fabric view/module registries: views registered by one copy are invisible to"
  );
  console.error(
    "   components resolving through the other. Native video and animated GIFs break on"
  );
  console.error(
    "   the installed binary (static images keep working) while typecheck, tests and the"
  );
  console.error("   JS bundle all stay green.\n");

  for (const [runtime, list] of byRuntime) {
    console.error(`   ${importerPath} resolves:`);
    console.error(`     ${runtime}: ${expected[runtime]}`);
    console.error(`   but these shared native packages resolve:`);
    for (const o of list) {
      console.error(`     ${o.key}`);
      console.error(`       ${runtime}: ${o.actual}`);
    }
    console.error("");
  }

  console.error("   How to fix:");
  console.error(
    "     This is almost always fallout from a bare workspace-root `pnpm install`"
  );
  console.error(
    "     re-resolving the expo/react-native peer group — often in a PR that has nothing"
  );
  console.error(
    "     to do with react-native. Point the offending entries' dependency back at the"
  );
  console.error(
    "     app's instance above (a surgical lockfile edit), or redo the dependency change"
  );
  console.error(
    "     with a scoped `pnpm add <pkg> --filter <workspace>` so the group isn't"
  );
  console.error(
    "     disturbed. Do NOT paper over it with pnpm.overrides — that hides the split"
  );
  console.error("     without collapsing the duplicate copies.\n");

  return false;
}

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
    // Library function: throw rather than process.exit — only the CLI
    // entrypoint (main()) owns exit codes. Message text matches what the CLI
    // used to print directly so stdout/stderr stay identical.
    throw new Error(`Could not read dependencies.react from ${pkgLabel}`);
  }

  // 2. Read the shared lockfile.
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(`Lockfile not found at ${lockfilePath}`);
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

/**
 * Gate #3: react-dom must be exactly version-matched with the react it's
 * keyed to, everywhere in the lockfile. Returns true when clean.
 *
 * Unlike gate #1 this is not scoped to the native graph or to the app's
 * pinned React — a workspace legitimately runs different Reacts in different
 * apps (e.g. mobile on the binary-pinned 19.1.0, web on 19.2.4), and each is
 * fine AS LONG AS any react-dom sharing that subgraph is the same exact
 * version. The hazard is the skewed pair itself: pinning `react` in one
 * workspace package (to control pnpm's peer dedup) while `react-dom` is only
 * auto-installed as someone's peer re-keys react-dom onto the pinned react
 * WITHOUT changing react-dom's own version — the lockfile ends up with e.g.
 * `/react-dom@19.2.4(react@19.1.0)`. react-dom's server renderer throws on
 * exactly this (React >= 19.2, ensureCorrectIsomorphicReactVersion), but only
 * when something actually renders — which is how Togather shipped a broken
 * verification email (react-email render in a Convex action) with CI green.
 */
function checkReactDomPairing(lockfilePath) {
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(`Lockfile not found at ${lockfilePath}`);
  }
  const lockLines = fs.readFileSync(lockfilePath, "utf-8").split("\n");

  const offenders = []; // { key, reactDom, react }

  for (const line of lockLines) {
    // Match both pnpm lockfile key shapes: v6 package keys have a leading
    // slash ("  /react-dom@19.2.4(react@19.1.0):"), v9+ snapshot keys don't
    // ("  react-dom@19.2.4(react@19.1.0):"). Gate #1 is v6-only (ported
    // unchanged from Togather), but this gate makes a lockfile-WIDE claim,
    // so silently matching nothing on a v9 lockfile would be a false green.
    const keyMatch = line.match(/^ {2}(\/?react-dom@.+):$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];

    const versionMatch = key.match(/^\/?react-dom@([0-9][^(]*?)(?:\(|$)/);
    if (!versionMatch) continue;
    const reactDomVersion = versionMatch[1];

    // Real react peer only: "(" immediately before "react@" (not "@types/react@").
    const peerMatch = key.match(/\(react@([0-9][^)]*)\)/);
    if (!peerMatch) continue; // no react peer keyed — nothing to compare

    const reactVersion = peerMatch[1];
    if (reactDomVersion !== reactVersion) {
      offenders.push({ key, reactDom: reactDomVersion, react: reactVersion });
    }
  }

  if (offenders.length > 0) {
    console.error("❌ react-dom / react version skew in the lockfile.\n");
    console.error(
      "   These react-dom instances are peer-keyed to a DIFFERENT react version"
    );
    console.error("   than their own:\n");
    for (const o of offenders) {
      console.error(`   • react-dom@${o.reactDom}  keyed to  react@${o.react}`);
      console.error(`       ${o.key}`);
    }
    console.error("");
    console.error(
      "   react and react-dom must be the EXACT same version. react-dom's server"
    );
    console.error(
      "   renderer hard-errors on this mismatch at runtime (React >= 19.2,"
    );
    console.error(
      "   ensureCorrectIsomorphicReactVersion) — but only when something actually"
    );
    console.error(
      "   renders, so typecheck, bundling and non-rendering tests all stay green."
    );
    console.error(
      "   Anything that server-renders through this react-dom (SSR, react-email"
    );
    console.error(
      "   templates in server functions) will throw in production.\n"
    );
    console.error(
      "   This usually happens when a workspace package pins `react` to an exact"
    );
    console.error(
      "   version (e.g. to control pnpm's peer dedup) but leaves `react-dom` to"
    );
    console.error(
      "   be auto-installed as a transitive peer, which resolves to the latest"
    );
    console.error("   version in range.\n");
    console.error("   How to fix:");
    console.error(
      "     Find the workspace package whose dependency subgraph contains the"
    );
    console.error(
      "     skewed pair (grep the lockfile importers for the react-dom version"
    );
    console.error(
      "     above) and pin react-dom to the SAME exact version as its react pin:"
    );
    console.error(
      "       pnpm add -D react-dom@<pinned react version> --filter <that package>"
    );
    console.error(
      "     then confirm the lockfile entry reads react-dom@X(react@X).\n"
    );
    return false;
  }

  console.log(
    "✅ react-dom pairing check passed — every react-dom in the lockfile matches its keyed react version exactly."
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

  // Gate #4 anchors on the app's own resolutions, so it needs the app's key in
  // the lockfile's `importers:` map — the app dir relative to the lockfile dir,
  // POSIX-separated (e.g. "apps/mobile"). "." when the app IS the lockfile root.
  const importerPath =
    args.importer ||
    path
      .relative(path.dirname(lockfilePath), path.dirname(pkgPath))
      .split(path.sep)
      .join("/") || ".";

  // A --config path that was explicitly passed but is missing/unparseable is
  // a hard failure: silently falling back to "no config" would quietly
  // disable scoped-package detection and the denylist extension while still
  // printing a green banner (the exact class of gap this tool exists to
  // prevent). loadConfig() throws in that case; a config path that was never
  // passed (configPath === null) is permissive and never throws.
  let nativeDepNames, denylistExtra;
  try {
    ({ nativeDepNames, denylistExtra } = loadConfig(configPath));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    console.error(
      "   Pass a valid --config path (native-deps.json), or omit --config entirely"
    );
    console.error(
      "   to skip scoped-package detection and denylist extension."
    );
    process.exit(1);
  }
  const denylist = [...DEFAULT_NATIVE_UNSAFE_DENYLIST, ...denylistExtra, ...args.denylist];

  // Run ALL gates (don't short-circuit — report every failure in one pass).
  // checkReactConsistency()/checkReactDomPairing() throw (rather than
  // process.exit) on a missing dependencies.react / lockfile — those are fatal
  // input errors, not a gate result, so catch here and let the CLI alone own
  // the exit code.
  let reactOk, pairingOk, instanceOk;
  try {
    reactOk = checkReactConsistency(pkgJson, pkgLabel, lockfilePath, nativeDepNames);
    pairingOk = checkReactDomPairing(lockfilePath);
    instanceOk = checkSingleNativeInstance(lockfilePath, nativeDepNames, importerPath);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
  const denylistOk = checkNativeUnsafeDenylist(pkgJson, pkgLabel, denylist);

  if (!reactOk || !pairingOk || !instanceOk || !denylistOk) {
    process.exit(1);
  }

  console.log(
    "\n✅ Native React graph OK — single React, one native instance, react-dom exactly paired, no native-unsafe dependencies."
  );
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  checkReactConsistency,
  checkReactDomPairing,
  checkSingleNativeInstance,
  parsePackageDependencies,
  parseImporterVersions,
  parseImporterKeys,
  SHARED_NATIVE_RUNTIMES,
  checkNativeUnsafeDenylist,
  packageNameFromKey,
  loadConfig,
  DEFAULT_NATIVE_UNSAFE_DENYLIST,
  NATIVE_PREFIX,
  EXCLUDED_NAMES,
};
