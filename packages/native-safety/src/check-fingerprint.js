#!/usr/bin/env node
/**
 * Check whether native code has changed since the last baseline.
 *
 * Uses @expo/fingerprint to calculate a hash of all native code in the
 * project. Compares against a stored .fingerprint file. If the fingerprint
 * differs, native code has changed and a new native build is required
 * before deploying an OTA update.
 *
 * Usage:
 *   npx @supa-media/native-safety check-fingerprint                    # Check against stored baseline
 *   npx @supa-media/native-safety check-fingerprint --update            # Update the stored baseline
 *   npx @supa-media/native-safety check-fingerprint --project-dir .     # Specify project directory
 *
 * Exit codes:
 *   0 - Fingerprint matches baseline (or --update was used)
 *   1 - Fingerprint changed (native rebuild required)
 *   2 - Error (missing dependencies, bad config, etc.)
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    update: false,
    projectDir: ".",
    fingerprintFile: ".fingerprint",
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--update":
        args.update = true;
        break;
      case "--project-dir":
        args.projectDir = argv[++i];
        break;
      case "--fingerprint-file":
        args.fingerprintFile = argv[++i];
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
Usage: check-fingerprint [options]

Options:
  --update                  Update the stored .fingerprint baseline
  --project-dir <path>      Expo project directory (default: ".")
  --fingerprint-file <path> Path to fingerprint file (default: ".fingerprint")
  --help, -h                Show this help message

Examples:
  check-fingerprint                              # Compare against baseline
  check-fingerprint --update                     # Save current fingerprint as baseline
  check-fingerprint --project-dir apps/mobile    # Check a specific project
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const projectDir = path.resolve(args.projectDir);
  const fingerprintPath = path.resolve(
    projectDir,
    args.fingerprintFile
  );

  // Try to load @expo/fingerprint
  let Fingerprint;
  try {
    Fingerprint = require("@expo/fingerprint");
  } catch {
    console.error(
      "Error: @expo/fingerprint is required but not installed.\n"
    );
    console.error("Install it as a dev dependency:");
    console.error("  pnpm add -D @expo/fingerprint");
    console.error("  npm install --save-dev @expo/fingerprint\n");
    process.exit(2);
  }

  // Calculate current fingerprint
  let currentFingerprint;
  try {
    const result = await Fingerprint.createFingerprintAsync(projectDir);
    currentFingerprint = result.hash;
  } catch (err) {
    console.error(`Error calculating fingerprint: ${err.message}`);
    process.exit(2);
  }

  // Update mode: save the baseline and exit
  if (args.update) {
    fs.writeFileSync(fingerprintPath, currentFingerprint + "\n", "utf-8");
    console.log(`Fingerprint baseline updated: ${currentFingerprint}`);
    console.log(`   Saved to ${path.relative(process.cwd(), fingerprintPath)}`);
    process.exit(0);
  }

  // Check mode: compare against stored baseline
  if (!fs.existsSync(fingerprintPath)) {
    console.error(
      `No fingerprint baseline found at ${path.relative(process.cwd(), fingerprintPath)}\n`
    );
    console.error(
      "Create one by running:"
    );
    console.error(
      `  npx @supa-media/native-safety check-fingerprint --update --project-dir ${args.projectDir}\n`
    );
    console.error(
      "This should be done after each native build and committed to the repo."
    );
    process.exit(2);
  }

  const storedFingerprint = fs
    .readFileSync(fingerprintPath, "utf-8")
    .trim();

  if (currentFingerprint === storedFingerprint) {
    console.log("Fingerprint matches baseline — OTA update is safe");
    console.log(`   Hash: ${currentFingerprint}`);
    process.exit(0);
  }

  // Fingerprint changed
  console.error("Native code has changed since the last baseline.\n");
  console.error(`   Baseline: ${storedFingerprint}`);
  console.error(`   Current:  ${currentFingerprint}\n`);
  console.error(
    "A native rebuild is required before deploying an OTA update."
  );
  console.error(
    "After rebuilding, update the baseline with:"
  );
  console.error(
    `  npx @supa-media/native-safety check-fingerprint --update --project-dir ${args.projectDir}\n`
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(2);
});
