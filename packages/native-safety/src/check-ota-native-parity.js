#!/usr/bin/env node
/**
 * CI enforcement: never publish an OTA update whose native dependency versions
 * disagree with the native binary that is actually installed on users' devices.
 *
 * Why this exists
 * ---------------
 * An OTA update (`eas update`) ships JAVASCRIPT ONLY. It cannot change the
 * native code compiled into an installed binary. So bumping an `expo-*` /
 * `react-native-*` version is a NATIVE change wearing a one-line-JSON disguise:
 * the new JS goes out over the air, the old native module stays on the device,
 * and the two halves of the same package are now different majors.
 *
 * When that happens to a package with a native VIEW, the view fails to register
 * and throws at render:
 *
 *   Invariant Violation: View config getter callback for component
 *   `ViewManagerAdapter_ExpoVideo_VideoView` must be a function (received `undefined`)
 *
 * On Fabric that invariant also corrupts the view registry, so it breaks
 * UNRELATED native rendering elsewhere in the app (a crashing video blanks
 * animated GIFs on a different screen). Nothing else in CI can see it:
 * typecheck passes, jest passes (native modules are mocked), the JS bundle
 * builds, and web E2E never touches Fabric.
 *
 * Togather shipped exactly this and it survived FOUR MONTHS of debugging:
 * `expo-video` was downgraded ^55.0.11 -> ^3.0.16 the day after the production
 * binary was built with v55, and every OTA since carried v3 JS to a v55 binary.
 * Its sibling `expo-audio` got the same skew, was noticed (voice recording
 * broke), and was pinned back — video was left behind with the note "works fine
 * in staging". See Togather's ADR-013 postmortem.
 *
 * Why the staging environment cannot catch it
 * ------------------------------------------
 * Apps typically rebuild the STAGING binary on every push, so staging's native
 * code always matches whatever the lockfile currently says, and the skew is
 * invisible there BY CONSTRUCTION. Production keeps its old binary and takes JS
 * only. "Verified on staging" is therefore not evidence for any native-graph
 * change.
 *
 * Why a fingerprint file cannot catch it
 * -------------------------------------
 * A checked-in fingerprint baseline (`check-fingerprint`) compares the working
 * tree to a file in the repo — and that file can be rewritten with `--update`
 * by the very commit that introduces the skew. It answers "did native inputs
 * change since someone last said they were fine?", not "does this JS match the
 * binary users have?". This check answers the second question, by asking the
 * build service which commit the deployed binary was actually built from.
 *
 * What this checks
 * ---------------
 * 1. Resolve the commit(s) the currently-deployed production binary was built
 *    from — passed via --build-commit, or derived from `eas build:list --json`
 *    output via --builds-json (newest FINISHED build per platform for the given
 *    build profile).
 * 2. Read the app's package.json AT that commit (`git show <sha>:<path>`).
 * 3. Compare its native dependency versions to the working tree's.
 * 4. Any added / removed / changed native dependency fails the check.
 *
 * It FAILS CLOSED: no build found, no commit hash recorded, or a commit that
 * cannot be fetched are all failures, never silent passes. A guard that skips
 * when it can't do its job is the gap this tool exists to remove.
 *
 * Usage:
 *   eas build:list --platform all --build-profile production \
 *     --status finished --limit 30 --json --non-interactive > builds.json
 *   npx @supa-media/native-safety check-ota-native-parity \
 *     --pkg apps/mobile/package.json --config apps/mobile/native-deps.json \
 *     --builds-json builds.json --profile production --platform all
 *
 *   # or, when you already know the commit:
 *   check-ota-native-parity --pkg apps/mobile/package.json --build-commit <sha>
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { NATIVE_PACKAGE_PATTERNS } = require("./patterns.js");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    pkg: null,
    config: null,
    buildCommit: null,
    buildsJson: null,
    profile: "production",
    platform: "all",
    repo: null,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--pkg":
        args.pkg = argv[++i];
        break;
      case "--config":
        args.config = argv[++i];
        break;
      case "--build-commit":
        args.buildCommit = argv[++i];
        break;
      case "--builds-json":
        args.buildsJson = argv[++i];
        break;
      case "--profile":
        args.profile = argv[++i];
        break;
      case "--platform":
        args.platform = argv[++i];
        break;
      case "--repo":
        args.repo = argv[++i];
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
Usage: check-ota-native-parity [options]

Verifies the working tree's native dependency versions match the binary the
deployed production build was compiled from. Run it immediately BEFORE
publishing a production OTA update.

Options:
  --pkg <path>            Path to the app's package.json (required)
  --config <path>         Path to native-deps.json ({ core, gated } name lists).
                           Adds scoped native packages the name-prefix heuristic
                           can't express (e.g. @gorhom/bottom-sheet). Exits 1 if
                           passed but missing/unparseable.
  --builds-json <path>    Output of \`eas build:list --json\`. Use "-" for stdin.
                           The newest FINISHED build per platform matching
                           --profile supplies the deployed commit.
  --build-commit <sha>    Deployed binary's commit, if you already know it.
                           Takes precedence over --builds-json.
  --profile <name>        EAS build profile to select (default: production)
  --platform <p>          ios | android | all (default: all). With "all", EVERY
                           platform that has a build must match — an OTA goes to
                           all of them.
  --repo <path>           Git repo root (default: cwd)
  --help, -h              Show this help message

Exit codes:
  0  native dependency versions match the deployed binary — safe to publish
  1  mismatch, or the deployed commit could not be determined (fails closed)
`);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Native package NAMES from native-deps.json (core + gated), covering scoped
 * packages the name-prefix patterns can't express.
 *
 * A `--config` path that was never passed is permissive (prefix matching only).
 * A path that WAS passed but is missing/unparseable throws: silently degrading
 * while still printing a green banner is precisely the failure mode this tool
 * exists to prevent.
 */
function loadConfig(configPath) {
  if (!configPath) return { nativeDepNames: new Set() };

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

  return { nativeDepNames: new Set([...(nd.core || []), ...(nd.gated || [])]) };
}

// ---------------------------------------------------------------------------
// Native dependency collection
// ---------------------------------------------------------------------------

/**
 * True when a package name identifies a package containing native code.
 *
 * Deliberately INCLUDES packages that are JS-only in practice but named like
 * native ones (e.g. expo-router): a false positive here costs one deliberate
 * native build, while a false negative ships a skewed OTA to production.
 */
function isNativePackage(name, nativeDepNames = new Set()) {
  if (nativeDepNames.has(name)) return true;
  return NATIVE_PACKAGE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Collect { name: versionSpec } for every native dependency of a package.json.
 *
 * Only `dependencies` are considered: a native module must be a runtime
 * dependency to be autolinked into the binary, and devDependencies (typecheck
 * shims, test harnesses) legitimately move without a native build.
 */
function collectNativeDeps(pkgJson, nativeDepNames = new Set()) {
  const out = {};
  for (const [name, spec] of Object.entries(pkgJson.dependencies || {})) {
    if (isNativePackage(name, nativeDepNames)) out[name] = spec;
  }
  return out;
}

/**
 * Compare deployed vs current native dependency maps.
 *
 * Returns { ok, changed, added, removed } where each entry names the package
 * and (for changed) both versions. Every difference matters: an added native
 * dep isn't in the binary at all, a removed one is still linked but its JS is
 * gone, and a changed one is the version-skew case.
 */
function diffNativeDeps(deployed, current) {
  const changed = [];
  const added = [];
  const removed = [];

  for (const [name, spec] of Object.entries(current)) {
    if (!(name in deployed)) {
      added.push({ name, spec });
    } else if (deployed[name] !== spec) {
      changed.push({ name, from: deployed[name], to: spec });
    }
  }

  for (const [name, spec] of Object.entries(deployed)) {
    if (!(name in current)) removed.push({ name, spec });
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  changed.sort(byName);
  added.sort(byName);
  removed.sort(byName);

  return { ok: changed.length === 0 && added.length === 0 && removed.length === 0, changed, added, removed };
}

// ---------------------------------------------------------------------------
// EAS build selection
// ---------------------------------------------------------------------------

const PLATFORM_ALIASES = { ios: "IOS", android: "ANDROID" };

/**
 * Pick the newest finished build per platform from `eas build:list --json`
 * output, restricted to one build profile.
 *
 * `eas build:list` already sorts newest-first, but completedAt is compared
 * explicitly so the result doesn't depend on that.
 */
function selectDeployedBuilds(builds, { profile = "production", platform = "all" } = {}) {
  if (!Array.isArray(builds)) {
    throw new Error("Builds JSON must be an array (the shape `eas build:list --json` prints).");
  }

  const wanted =
    platform === "all"
      ? Object.values(PLATFORM_ALIASES)
      : [PLATFORM_ALIASES[String(platform).toLowerCase()]];

  if (wanted.some((p) => !p)) {
    throw new Error(`Unknown --platform "${platform}" (expected ios, android, or all).`);
  }

  const newest = new Map();
  for (const build of builds) {
    if (!build || build.status !== "FINISHED") continue;
    if (profile && build.buildProfile !== profile) continue;
    if (!wanted.includes(build.platform)) continue;

    const previous = newest.get(build.platform);
    if (!previous || String(build.completedAt || "") > String(previous.completedAt || "")) {
      newest.set(build.platform, build);
    }
  }

  return [...newest.values()]
    .map((build) => ({
      platform: build.platform,
      id: build.id,
      commit: build.gitCommitHash || null,
      appVersion: build.appVersion || null,
      appBuildVersion: build.appBuildVersion || null,
      completedAt: build.completedAt || null,
      channel: build.channel || null,
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform));
}

// ---------------------------------------------------------------------------
// Git access
// ---------------------------------------------------------------------------

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function hasCommit(sha, cwd) {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make a commit available locally. CI checkouts are shallow (fetch-depth 1), so
 * a months-old build commit usually isn't present — fetch it on demand rather
 * than forcing every consumer to deepen its checkout.
 */
function ensureCommit(sha, cwd) {
  if (hasCommit(sha, cwd)) return true;
  try {
    git(["fetch", "--depth=1", "origin", sha], cwd);
  } catch {
    try {
      git(["fetch", "origin", sha], cwd);
    } catch {
      return false;
    }
  }
  return hasCommit(sha, cwd);
}

function readFileAtCommit(sha, relPath, cwd) {
  // Forward slashes: git pathspecs are POSIX even on Windows checkouts.
  const spec = `${sha}:${relPath.split(path.sep).join("/")}`;
  try {
    return git(["show", spec], cwd);
  } catch (err) {
    throw new Error(`Could not read ${relPath} at commit ${sha} (git show ${spec} failed: ${err.message})`);
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function describeBuild(build) {
  const version = [build.appVersion, build.appBuildVersion].filter(Boolean).join(" / build ");
  const bits = [build.platform.toLowerCase()];
  if (version) bits.push(version);
  if (build.completedAt) bits.push(`built ${build.completedAt}`);
  if (build.id) bits.push(`build ${build.id}`);
  return bits.join(", ");
}

function reportMismatch(build, diff, pkgLabel) {
  console.error(`\n❌ OTA/native parity FAILED for ${describeBuild(build)}`);
  console.error(`   Deployed binary was built from commit ${build.commit}`);
  console.error(`   ${pkgLabel}'s native dependencies have moved since then:\n`);

  for (const { name, from, to } of diff.changed) {
    console.error(`   ~ ${name}: binary has ${from}, this bundle ships ${to}`);
  }
  for (const { name, spec } of diff.added) {
    console.error(`   + ${name}@${spec} is NOT in the deployed binary at all`);
  }
  for (const { name, spec } of diff.removed) {
    console.error(`   - ${name}@${spec} is linked into the binary but gone from this bundle`);
  }

  console.error(
    "\n   An OTA update ships JavaScript only — it cannot change the native code"
  );
  console.error(
    "   in an already-installed binary. Publishing this bundle would put JS of"
  );
  console.error(
    "   one version against native code of another. For a package with a native"
  );
  console.error(
    "   view that means `ViewManagerAdapter_… must be a function (received"
  );
  console.error(
    "   undefined)` at render time, and on Fabric that invariant corrupts the"
  );
  console.error(
    "   view registry, breaking unrelated native rendering elsewhere in the app."
  );
  console.error(
    "\n   Note this is invisible on a staging environment that rebuilds its"
  );
  console.error(
    "   binary on every push: staging's native code always matches the lockfile."
  );
  console.error("\n   How to fix — pick one:");
  console.error(
    "     a) Ship a NEW production native build from this commit, wait for it to"
  );
  console.error(
    "        finish, then re-run this deploy. (Correct when the version bump is"
  );
  console.error("        intended.)");
  console.error(
    "     b) Restore the versions above to what the binary has, so the OTA"
  );
  console.error(
    "        matches the installed native code. (Correct when the bump was"
  );
  console.error(
    "        accidental, or when you need to fix production before a store"
  );
  console.error("        release lands.)");
  console.error(
    "\n   Do NOT resolve this by re-baselining a fingerprint file — that records"
  );
  console.error(
    "   an intention, not what users have installed, and is how this class of"
  );
  console.error("   bug survives for months.\n");
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

  if (!args.buildCommit && !args.buildsJson) {
    console.error("Error: pass --build-commit <sha> or --builds-json <path> (use \"-\" for stdin).");
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  const repoRoot = args.repo ? path.resolve(args.repo) : process.cwd();
  const pkgPath = path.resolve(args.pkg);

  if (!fs.existsSync(pkgPath)) {
    console.error(`Error: package.json not found at ${pkgPath}`);
    process.exit(1);
  }

  // git pathspecs are relative to the repo root, not the cwd.
  const pkgRelPath = path.relative(repoRoot, pkgPath);
  if (pkgRelPath.startsWith("..")) {
    console.error(`Error: ${pkgPath} is outside the repo root ${repoRoot}. Pass --repo.`);
    process.exit(1);
  }
  const pkgLabel = pkgRelPath.split(path.sep).join("/");

  let nativeDepNames;
  try {
    ({ nativeDepNames } = loadConfig(args.config ? path.resolve(args.config) : null));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    console.error("   Pass a valid --config path (native-deps.json), or omit --config entirely.");
    process.exit(1);
  }

  const currentPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const current = collectNativeDeps(currentPkg, nativeDepNames);

  // Resolve which builds (and therefore which commits) we're comparing against.
  let targets;
  if (args.buildCommit) {
    targets = [{ platform: "PINNED", id: null, commit: args.buildCommit, appVersion: null, appBuildVersion: null, completedAt: null, channel: null }];
  } else {
    let raw;
    try {
      raw = args.buildsJson === "-" ? fs.readFileSync(0, "utf-8") : fs.readFileSync(path.resolve(args.buildsJson), "utf-8");
    } catch (err) {
      console.error(`❌ Could not read builds JSON: ${err.message}`);
      process.exit(1);
    }

    let builds;
    try {
      builds = JSON.parse(raw);
    } catch (err) {
      console.error(`❌ Could not parse builds JSON: ${err.message}`);
      console.error("   Expected the array printed by `eas build:list --json`.");
      process.exit(1);
    }

    try {
      targets = selectDeployedBuilds(builds, { profile: args.profile, platform: args.platform });
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }

    if (targets.length === 0) {
      console.error(
        `❌ No FINISHED "${args.profile}" build found for platform "${args.platform}".`
      );
      console.error(
        "   Cannot prove this OTA matches the binary users have installed, so this"
      );
      console.error(
        "   fails closed. Widen `eas build:list --limit`, check --profile/--platform,"
      );
      console.error("   or ship a production native build first.");
      process.exit(1);
    }
  }

  let failed = false;

  for (const build of targets) {
    if (!build.commit) {
      console.error(`❌ ${describeBuild(build)} has no gitCommitHash recorded on EAS.`);
      console.error(
        "   Without it there is no way to know which native versions that binary"
      );
      console.error(
        "   contains, so this fails closed. Re-run the native build from CI (a git"
      );
      console.error("   context) so EAS records the commit.");
      failed = true;
      continue;
    }

    if (!ensureCommit(build.commit, repoRoot)) {
      console.error(
        `❌ Commit ${build.commit} (${describeBuild(build)}) is not available locally and could not be fetched.`
      );
      console.error(
        "   Fetch it in CI (`git fetch --depth=1 origin <sha>`) or check out with"
      );
      console.error("   more history, then re-run.");
      failed = true;
      continue;
    }

    let deployedPkg;
    try {
      deployedPkg = JSON.parse(readFileAtCommit(build.commit, pkgRelPath, repoRoot));
    } catch (err) {
      console.error(`❌ ${err.message}`);
      failed = true;
      continue;
    }

    const deployed = collectNativeDeps(deployedPkg, nativeDepNames);
    const diff = diffNativeDeps(deployed, current);

    if (diff.ok) {
      console.log(
        `✅ ${describeBuild(build)} — all ${Object.keys(current).length} native dependencies match commit ${build.commit.slice(0, 8)}.`
      );
    } else {
      reportMismatch(build, diff, pkgLabel);
      failed = true;
    }
  }

  if (failed) process.exit(1);

  console.log(
    "\n✅ OTA/native parity OK — this bundle's native dependency versions match every deployed binary."
  );
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectNativeDeps,
  diffNativeDeps,
  selectDeployedBuilds,
  isNativePackage,
  loadConfig,
};
