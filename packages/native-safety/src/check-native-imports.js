#!/usr/bin/env node
/**
 * CI enforcement: catch ungated static imports of native dependencies.
 *
 * Gated native deps must be imported dynamically behind a NativeModules
 * check (see hasNativeModule). Static imports bypass that safety net and
 * crash on older native builds that don't include the module.
 *
 * This script:
 * 1. Reads the consumer's native-deps.json (core vs gated classification)
 * 2. Scans all .ts/.tsx/.js/.jsx source files for static imports of gated deps
 * 3. Optionally checks that every native dep in package.json is classified
 * 4. Fails CI if violations are found
 *
 * Usage:
 *   npx @supa-media/native-safety check-native-imports --config native-deps.json --src apps/mobile
 *   npx @supa-media/native-safety check-native-imports --config native-deps.json --src apps/mobile --allowlist features/chat/utils/fileTypes.ts,components/ui/SafeLinearGradient.tsx
 *   npx @supa-media/native-safety check-native-imports --config native-deps.json --src apps/mobile --check-package-json
 */

const fs = require("fs");
const path = require("path");
const {
  STATIC_IMPORT_REGEX,
  SKIP_DIRS,
  SOURCE_EXTENSIONS,
  EXCLUDE_FILE_PATTERNS,
  isNativePackage,
} = require("./patterns");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    config: null,
    src: null,
    allowlist: [],
    checkPackageJson: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--config":
        args.config = argv[++i];
        break;
      case "--src":
        args.src = argv[++i];
        break;
      case "--allowlist":
        args.allowlist = argv[++i].split(",").map((f) => f.trim());
        break;
      case "--check-package-json":
        args.checkPackageJson = true;
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
Usage: check-native-imports [options]

Options:
  --config <path>          Path to native-deps.json (required)
  --src <path>             Source directory to scan (required)
  --allowlist <files>      Comma-separated list of files that are allowed to
                           import gated deps (relative to --src)
  --check-package-json     Also verify all native deps in package.json are
                           classified in native-deps.json
  --help, -h               Show this help message

Examples:
  check-native-imports --config native-deps.json --src apps/mobile
  check-native-imports --config native-deps.json --src . --allowlist utils/gating.ts,components/SafeGradient.tsx
  check-native-imports --config native-deps.json --src . --check-package-json
`);
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

/**
 * Recursively find source files, skipping excluded directories
 */
function findSourceFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      findSourceFiles(fullPath, files);
    } else if (
      SOURCE_EXTENSIONS.test(entry.name) &&
      !EXCLUDE_FILE_PATTERNS.test(entry.name)
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  if (!args.config) {
    console.error("Error: --config is required. Pass the path to your native-deps.json.");
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  if (!args.src) {
    console.error("Error: --src is required. Pass the source directory to scan.");
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  // Resolve paths relative to cwd
  const configPath = path.resolve(args.config);
  const srcRoot = path.resolve(args.src);

  // 1. Load config
  if (!fs.existsSync(configPath)) {
    console.error(`Error: native-deps.json not found at ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const coreDeps = new Set(config.core || []);
  const gatedDeps = new Set(config.gated || []);
  const allClassified = new Set([...coreDeps, ...gatedDeps]);

  if (gatedDeps.size === 0) {
    console.log("No gated dependencies defined in native-deps.json. Nothing to check.");
    process.exit(0);
  }

  // 2. Optionally check that all native deps in package.json are classified
  if (args.checkPackageJson) {
    // Find the nearest package.json relative to the source root
    let pkgDir = srcRoot;
    let packageJsonPath = null;
    while (pkgDir !== path.dirname(pkgDir)) {
      const candidate = path.join(pkgDir, "package.json");
      if (fs.existsSync(candidate)) {
        packageJsonPath = candidate;
        break;
      }
      pkgDir = path.dirname(pkgDir);
    }

    if (packageJsonPath) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const allDeps = Object.keys(packageJson.dependencies || {});
      const nativeDeps = allDeps.filter(isNativePackage);
      const unclassified = nativeDeps.filter((dep) => !allClassified.has(dep));

      if (unclassified.length > 0) {
        console.error("Unclassified native dependencies found in package.json:\n");
        for (const dep of unclassified) {
          console.error(`   ${dep}`);
        }
        console.error("");
        console.error(
          "   Add each dependency to either 'core' or 'gated' in native-deps.json."
        );
        console.error(
          "   - core: present in the baseline native build (safe for static import)"
        );
        console.error(
          "   - gated: requires runtime NativeModules check before import"
        );
        process.exit(1);
      }
    }
  }

  // 3. Scan source files for static imports of gated deps
  if (!fs.existsSync(srcRoot)) {
    console.error(`Error: source directory not found at ${srcRoot}`);
    process.exit(1);
  }

  const allowlistedFiles = new Set(args.allowlist);
  const sourceFiles = findSourceFiles(srcRoot);
  const violations = [];

  for (const filePath of sourceFiles) {
    const relativePath = path.relative(srcRoot, filePath);

    // Skip allowlisted files (they contain the gating logic itself)
    if (allowlistedFiles.has(relativePath)) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    let match;

    // Reset regex state for each file
    const importRegex = new RegExp(STATIC_IMPORT_REGEX.source, "g");
    while ((match = importRegex.exec(content)) !== null) {
      const importedPackage = match[1];

      // Check if this is a static import of a gated dep
      // Also match sub-paths like 'expo-av/something'
      const basePackage = importedPackage.startsWith("@")
        ? importedPackage.split("/").slice(0, 2).join("/")
        : importedPackage.split("/")[0];

      if (gatedDeps.has(importedPackage) || gatedDeps.has(basePackage)) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

        violations.push({
          file: relativePath,
          line: lineNumber,
          dep: importedPackage,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error("Static imports of gated native dependencies found:\n");
    for (const v of violations) {
      console.error(`   ${v.file}:${v.line}`);
      console.error(`   Static import of: ${v.dep}\n`);
    }
    console.error(
      "   Gated native dependencies must be imported dynamically behind a"
    );
    console.error(
      "   NativeModules check. Use the hasNativeModule() pattern:\n"
    );
    console.error(
      "   1. Check hasNativeModule('ModuleName') before importing"
    );
    console.error(
      "   2. Use dynamic require() only when the native module exists"
    );
    console.error("   3. Provide a fallback for when it's not available\n");
    process.exit(1);
  }

  // All checks passed
  console.log("Native import gating check passed");
  console.log(`   Scanned ${sourceFiles.length} source files`);
  console.log(`   Core deps: ${coreDeps.size}, Gated deps: ${gatedDeps.size}`);
}

main();
