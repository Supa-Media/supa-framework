#!/usr/bin/env node
/**
 * Generate an OTA version string for Expo updates.
 *
 * Format: RUNTIME_VERSION.MMDDYY.HHMM
 * Example: 1.0.21.040826.1432
 *
 * The runtime version is read from (in priority order):
 *   1. --runtime-version CLI flag
 *   2. supa.config.json "runtimeVersion" field
 *   3. app.json "expo.runtimeVersion" field
 *   4. app.json "expo.version" field
 *
 * Usage:
 *   npx @supa-media/scripts generate-ota-version
 *   npx @supa-media/scripts generate-ota-version --runtime-version 1.0.21
 *   npx @supa-media/scripts generate-ota-version --app-json ./apps/mobile/app.json
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let runtimeVersion = null;
let appJsonPath = null;
let configPath = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--runtime-version":
      runtimeVersion = args[++i];
      break;
    case "--app-json":
      appJsonPath = args[++i];
      break;
    case "--config":
      configPath = args[++i];
      break;
    case "--help":
    case "-h":
      console.log("Usage: supa-generate-ota-version [options]");
      console.log("");
      console.log("Generates an OTA version string: RUNTIME_VERSION.MMDDYY.HHMM");
      console.log("");
      console.log("Options:");
      console.log("  --runtime-version VER  Override the runtime version");
      console.log("  --app-json PATH        Path to app.json (default: ./app.json)");
      console.log("  --config PATH          Path to supa.config.json");
      console.log("  -h, --help             Show this help message");
      process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Resolve runtime version
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

if (!runtimeVersion) {
  // Try supa.config.json
  const supaConfig = findFile(
    configPath ? [configPath] : ["./supa.config.json", "../supa.config.json"]
  );
  if (supaConfig) {
    try {
      const cfg = JSON.parse(fs.readFileSync(supaConfig, "utf-8"));
      runtimeVersion = cfg.runtimeVersion || null;
    } catch {
      // ignore parse errors
    }
  }
}

if (!runtimeVersion) {
  // Try app.json
  const appJson = findFile(
    appJsonPath
      ? [appJsonPath]
      : [
          "./app.json",
          "./apps/mobile/app.json",
          "../app.json",
          "../apps/mobile/app.json",
        ]
  );
  if (appJson) {
    try {
      const app = JSON.parse(fs.readFileSync(appJson, "utf-8"));
      const expo = app.expo || app;
      runtimeVersion = expo.runtimeVersion || expo.version || null;
    } catch {
      // ignore parse errors
    }
  }
}

if (!runtimeVersion) {
  console.error(
    "Error: Could not determine runtime version. Provide --runtime-version or ensure app.json exists."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Generate version string
// ---------------------------------------------------------------------------
const now = new Date();

const mm = String(now.getMonth() + 1).padStart(2, "0");
const dd = String(now.getDate()).padStart(2, "0");
const yy = String(now.getFullYear()).slice(-2);

const hh = String(now.getHours()).padStart(2, "0");
const min = String(now.getMinutes()).padStart(2, "0");

const otaVersion = `${runtimeVersion}.${mm}${dd}${yy}.${hh}${min}`;

// Output the version string (for CI to capture via $(npx ...))
console.log(otaVersion);
