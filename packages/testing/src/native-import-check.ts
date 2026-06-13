/**
 * Native Import Gating Check for Expo/React Native apps.
 *
 * Native dependencies that aren't in the baseline native build must be imported
 * dynamically behind a `NativeModules` runtime check. Static imports of these
 * "gated" dependencies will crash on older native builds that don't include them.
 *
 * This module wraps the check-native-imports logic as a reusable test:
 * 1. Reads a `native-deps.json` config that classifies deps as `core` or `gated`
 * 2. Scans source files for static imports of gated dependencies
 * 3. Checks that all native deps in package.json are classified
 * 4. Reports violations with file paths and line numbers
 *
 * See also: `@supa-media/native-safety` for the CLI enforcement script.
 */

import * as fs from "fs";
import * as path from "path";

// ----- Types ----------------------------------------------------------------

export interface NativeImportCheckConfig {
  /** Root source directory of the app (e.g. `apps/mobile`) */
  srcDir: string;
  /**
   * Path to the `native-deps.json` config file (relative to srcDir or absolute).
   * Default: `"native-deps.json"` (relative to srcDir)
   */
  nativeDepsPath?: string;
  /**
   * Files allowed to statically import gated deps (relative to srcDir).
   * These are typically the gating utility files themselves.
   */
  allowlist?: string[];
}

export interface NativeImportViolation {
  /** File path relative to srcDir */
  file: string;
  /** Line number of the offending import */
  line: number;
  /** The gated dependency that was statically imported */
  dependency: string;
}

export interface UnclassifiedDependency {
  /** Package name */
  name: string;
}

export interface NativeImportCheckResult {
  /** Static imports of gated dependencies */
  violations: NativeImportViolation[];
  /** Native dependencies in package.json that aren't classified in native-deps.json */
  unclassified: UnclassifiedDependency[];
}

// ----- Native package detection ----------------------------------------------

const NATIVE_PACKAGE_PATTERNS = [
  /^react-native$/,
  /^react-native-/,
  /^@react-native\//,
  /^@react-native-community\//,
  /^@react-native-picker\//,
  /^@react-native-async-storage\//,
  /^expo$/,
  /^expo-/,
  /^@expo\//,
  /^@sentry\/react-native/,
  /^@shopify\/flash-list/,
  /^@gorhom\/bottom-sheet/,
  /^@rnmapbox\//,
  /^@mapbox\//,
];

function isNativePackage(name: string): boolean {
  return NATIVE_PACKAGE_PATTERNS.some((p) => p.test(name));
}

// ----- File system helpers ---------------------------------------------------

function findSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSourceFiles(fullPath));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

// ----- Public API ------------------------------------------------------------

/**
 * Checks for static imports of gated native dependencies.
 *
 * @returns Violations (static imports of gated deps) and unclassified
 *   dependencies (native deps not listed in native-deps.json).
 *
 * @example
 * ```ts
 * const result = checkNativeImports({
 *   srcDir: '/path/to/apps/mobile',
 *   nativeDepsPath: 'native-deps.json',
 *   allowlist: [
 *     'features/chat/utils/fileTypes.ts',
 *     'components/ui/SafeLinearGradient.tsx',
 *   ],
 * });
 * ```
 */
export function checkNativeImports(
  config: NativeImportCheckConfig
): NativeImportCheckResult {
  const srcDir = path.resolve(config.srcDir);
  const nativeDepsPath = path.isAbsolute(config.nativeDepsPath ?? "")
    ? config.nativeDepsPath!
    : path.join(srcDir, config.nativeDepsPath ?? "native-deps.json");
  const allowlist = new Set(config.allowlist ?? []);

  const violations: NativeImportViolation[] = [];
  const unclassified: UnclassifiedDependency[] = [];

  // ---- Load native-deps.json ----

  if (!fs.existsSync(nativeDepsPath)) {
    throw new Error(
      `native-deps.json not found at "${nativeDepsPath}". ` +
        `This file classifies native dependencies as "core" (safe for static import) ` +
        `or "gated" (requires runtime NativeModules check). ` +
        `Create it with: { "core": [...], "gated": [...] }`
    );
  }

  const depsConfig = JSON.parse(fs.readFileSync(nativeDepsPath, "utf-8"));
  const coreDeps = new Set<string>(depsConfig.core ?? []);
  const gatedDeps = new Set<string>(depsConfig.gated ?? []);
  const allClassified = new Set([...coreDeps, ...gatedDeps]);

  // ---- Check all native deps are classified ----

  const packageJsonPath = path.join(srcDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8")
    );
    const allDeps = Object.keys(packageJson.dependencies ?? {});
    const nativeDeps = allDeps.filter(isNativePackage);

    for (const dep of nativeDeps) {
      if (!allClassified.has(dep)) {
        unclassified.push({ name: dep });
      }
    }
  }

  // ---- Scan for static imports of gated deps ----

  if (gatedDeps.size === 0) {
    return { violations, unclassified };
  }

  const sourceFiles = findSourceFiles(srcDir);
  const importRegex =
    /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+(?:[\s\S]*?\s+from\s+)?)['"]([^'"]+)['"]/g;

  for (const filePath of sourceFiles) {
    const relativePath = path.relative(srcDir, filePath);

    // Skip allowlisted files
    if (allowlist.has(relativePath)) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    importRegex.lastIndex = 0;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importedPackage = match[1];
      if (importedPackage && gatedDeps.has(importedPackage)) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
        violations.push({
          file: relativePath,
          line: lineNumber,
          dependency: importedPackage,
        });
      }
    }
  }

  return { violations, unclassified };
}

/**
 * Jest/Vitest-compatible test function. Throws a descriptive error if any
 * native import violations are found.
 *
 * @example
 * ```ts
 * import { testNativeImports } from '@supa-media/testing';
 * test('no ungated native imports', () => testNativeImports({
 *   srcDir: 'apps/mobile',
 *   nativeDepsPath: 'native-deps.json',
 * }));
 * ```
 */
export function testNativeImports(config: NativeImportCheckConfig): void {
  const result = checkNativeImports(config);

  const errors: string[] = [];

  if (result.unclassified.length > 0) {
    const deps = result.unclassified.map((d) => `    ${d.name}`).join("\n");
    errors.push(
      `Unclassified native dependencies found in package.json:\n${deps}\n\n` +
        `Add each dependency to either "core" or "gated" in native-deps.json.\n` +
        `  - core: present in the baseline native build (safe for static import)\n` +
        `  - gated: requires runtime NativeModules check before import\n`
    );
  }

  if (result.violations.length > 0) {
    const details = result.violations
      .map(
        (v) =>
          `    ${v.file}:${v.line} — static import of "${v.dependency}"`
      )
      .join("\n");

    errors.push(
      `Static imports of gated native dependencies found:\n${details}\n\n` +
        `Gated native dependencies must be imported dynamically behind a\n` +
        `NativeModules check. Pattern:\n` +
        `  1. Add a detection function (e.g. isModuleSupported())\n` +
        `  2. Use dynamic require() only when the native module exists\n` +
        `  3. Provide a fallback for when it's not available\n`
    );
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
