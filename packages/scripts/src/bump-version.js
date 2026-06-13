#!/usr/bin/env node
/**
 * Bump app version in app.json / app.config.js.
 *
 * Updates:
 *   - expo.version (semver string)
 *   - expo.ios.buildNumber (integer string, auto-incremented)
 *   - expo.android.versionCode (integer, auto-incremented)
 *
 * Usage:
 *   npx @supa-media/scripts bump-version --patch
 *   npx @supa-media/scripts bump-version --minor
 *   npx @supa-media/scripts bump-version --major
 *   npx @supa-media/scripts bump-version --version 2.0.0
 *   npx @supa-media/scripts bump-version --patch --dry-run
 *   npx @supa-media/scripts bump-version --patch --app-json ./apps/mobile/app.json
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

let bumpType = null;
let explicitVersion = null;
let dryRun = false;
let appJsonPath = null;
let appConfigPath = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--patch":
      bumpType = "patch";
      break;
    case "--minor":
      bumpType = "minor";
      break;
    case "--major":
      bumpType = "major";
      break;
    case "--version":
      explicitVersion = args[++i];
      break;
    case "--dry-run":
      dryRun = true;
      break;
    case "--app-json":
      appJsonPath = args[++i];
      break;
    case "--app-config":
      appConfigPath = args[++i];
      break;
    case "--help":
    case "-h":
      console.log("Usage: supa-bump-version [options]");
      console.log("");
      console.log("Bump app version in app.json and app.config.js.");
      console.log("");
      console.log("Options:");
      console.log("  --patch            Bump patch version (1.0.0 -> 1.0.1)");
      console.log("  --minor            Bump minor version (1.0.0 -> 1.1.0)");
      console.log("  --major            Bump major version (1.0.0 -> 2.0.0)");
      console.log("  --version VER      Set an explicit version");
      console.log("  --dry-run          Preview changes without writing");
      console.log("  --app-json PATH    Path to app.json");
      console.log("  --app-config PATH  Path to app.config.js");
      console.log("  -h, --help         Show this help message");
      process.exit(0);
  }
}

if (!bumpType && !explicitVersion) {
  console.error("Error: Specify --patch, --minor, --major, or --version X.Y.Z");
  console.error("Run with --help for usage.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Find files
// ---------------------------------------------------------------------------
function findFile(candidates) {
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

const appJson = appJsonPath
  ? path.resolve(appJsonPath)
  : findFile([
      "./app.json",
      "./apps/mobile/app.json",
      "../app.json",
      "../apps/mobile/app.json",
    ]);

const appConfig = appConfigPath
  ? path.resolve(appConfigPath)
  : findFile([
      "./app.config.js",
      "./apps/mobile/app.config.js",
      "../app.config.js",
      "../apps/mobile/app.config.js",
    ]);

if (!appJson) {
  console.error("Error: app.json not found. Use --app-json to specify the path.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------
function parseVersion(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
  };
}

function bumpVersion(current, type) {
  const v = parseVersion(current);
  if (!v) {
    console.error(`Invalid version: ${current}`);
    process.exit(1);
  }
  switch (type) {
    case "major":
      return `${v.major + 1}.0.0`;
    case "minor":
      return `${v.major}.${v.minor + 1}.0`;
    case "patch":
      return `${v.major}.${v.minor}.${v.patch + 1}`;
  }
}

function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;
  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;
  return 0;
}

// ---------------------------------------------------------------------------
// Read current version
// ---------------------------------------------------------------------------
const appJsonContent = JSON.parse(fs.readFileSync(appJson, "utf-8"));
const expo = appJsonContent.expo || appJsonContent;
const currentVersion = expo.version;

if (!currentVersion) {
  console.error("Error: No version found in app.json");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Calculate new version
// ---------------------------------------------------------------------------
let newVersion;
if (explicitVersion) {
  if (!parseVersion(explicitVersion)) {
    console.error(`Invalid version format: ${explicitVersion} (expected X.Y.Z)`);
    process.exit(1);
  }
  newVersion = explicitVersion;
} else {
  newVersion = bumpVersion(currentVersion, bumpType);
}

if (compareVersions(newVersion, currentVersion) <= 0) {
  console.error(
    `Error: New version (${newVersion}) must be greater than current (${currentVersion})`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Calculate build numbers
// ---------------------------------------------------------------------------
const currentBuildNumber = parseInt(
  expo.ios?.buildNumber || expo.android?.versionCode || "1",
  10
);
const newBuildNumber = currentBuildNumber + 1;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`Current version:  ${currentVersion}`);
console.log(`New version:      ${newVersion}`);
console.log(`Build number:     ${currentBuildNumber} -> ${newBuildNumber}`);
console.log("");

if (dryRun) {
  console.log("Dry run - no files will be modified.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Update app.json
// ---------------------------------------------------------------------------
console.log("Updating files:");

expo.version = newVersion;

// Update iOS buildNumber
if (!expo.ios) expo.ios = {};
expo.ios.buildNumber = String(newBuildNumber);

// Update Android versionCode
if (!expo.android) expo.android = {};
expo.android.versionCode = newBuildNumber;

fs.writeFileSync(appJson, JSON.stringify(appJsonContent, null, 2) + "\n");
console.log(`  [ok] ${path.relative(process.cwd(), appJson)}`);

// ---------------------------------------------------------------------------
// Update app.config.js (if it exists)
// ---------------------------------------------------------------------------
if (appConfig && fs.existsSync(appConfig)) {
  let configContent = fs.readFileSync(appConfig, "utf-8");
  let modified = false;

  // Update version string
  const versionRegex = /version:\s*["'][^"']+["']/;
  if (versionRegex.test(configContent)) {
    configContent = configContent.replace(versionRegex, `version: "${newVersion}"`);
    modified = true;
  }

  // Update runtimeVersion string
  const runtimeRegex = /runtimeVersion:\s*["'][^"']+["']/;
  if (runtimeRegex.test(configContent)) {
    configContent = configContent.replace(
      runtimeRegex,
      `runtimeVersion: "${newVersion}"`
    );
    modified = true;
  }

  // Update otaVersion fallback
  const otaRegex =
    /otaVersion:\s*process\.env\.OTA_VERSION\s*\|\|\s*["'][^"']+["']/;
  if (otaRegex.test(configContent)) {
    configContent = configContent.replace(
      otaRegex,
      `otaVersion: process.env.OTA_VERSION || "${newVersion}"`
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(appConfig, configContent);
    console.log(`  [ok] ${path.relative(process.cwd(), appConfig)}`);
  } else {
    console.log(
      `  [skip] ${path.relative(process.cwd(), appConfig)} (no version fields found)`
    );
  }
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log("");
console.log(`Version bumped to ${newVersion} (build ${newBuildNumber})`);
console.log("");
console.log("Next steps:");
console.log(`  git add -A && git commit -m 'chore: bump version to ${newVersion}'`);
