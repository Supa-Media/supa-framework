/**
 * Web Bundle Safety Tests for Expo/React Native apps.
 *
 * When Metro bundles for web, native-only code will crash the bundle. Common
 * culprits:
 *
 * - **Zustand v5** uses `import.meta.env.MODE` which crashes Metro web bundles
 *   (served as regular `<script>`, not ES modules).
 * - **Native modules** like `@react-native-community/netinfo` may not have web
 *   support.
 *
 * The fix: every file importing native-only packages must have a `.web.ts` or
 * `.web.tsx` counterpart that Metro resolves instead when bundling for web.
 *
 * This module checks:
 * - Zustand stores have `.web.ts` counterparts that don't import Zustand
 * - Native providers have `.web.tsx` counterparts
 * - Export signatures match between native and web files
 * - No `.web.*` files use `import.meta` (crashes Metro web bundles)
 */

import * as fs from "fs";
import * as path from "path";

// ----- Types ----------------------------------------------------------------

export interface WebBundleSafetyConfig {
  /** Root source directory of the app (e.g. `apps/mobile`) */
  srcDir: string;
  /** Subdirectory containing Zustand stores. Default: `"stores"` */
  storesDir?: string;
  /** Subdirectory containing providers. Default: `"providers"` */
  providersDir?: string;
  /**
   * Additional directories to scan for `.web.*` files that must not use
   * `import.meta`. Default: `["components"]`
   */
  additionalWebDirs?: string[];
  /**
   * Regex patterns that identify native-only imports in provider files.
   * If a provider file matches any of these, it must have a `.web.tsx` counterpart.
   * Default: `[/useConvexConnectionState/]`
   */
  nativeOnlyPatterns?: RegExp[];
}

export interface WebBundleViolation {
  /** File path relative to srcDir */
  file: string;
  /** What went wrong */
  issue: string;
  /** How to fix it */
  fix: string;
}

export interface WebBundleSafetyResult {
  violations: WebBundleViolation[];
}

// ----- File system helpers ---------------------------------------------------

function findSourceFiles(
  dir: string,
  extensions: string[] = [".ts", ".tsx"]
): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSourceFiles(fullPath, extensions));
    } else if (
      extensions.some((ext) => entry.name.endsWith(ext)) &&
      !entry.name.includes(".web.") &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function findWebFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findWebFiles(fullPath));
    } else if (entry.name.includes(".web.")) {
      results.push(fullPath);
    }
  }
  return results;
}

function getWebCounterpart(filePath: string): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  return `${base}.web${ext}`;
}

/**
 * Extracts named and default exports from a file using simple regex matching.
 * This is intentionally basic — it handles `export const/let/var/function/class`
 * and `export default`.
 */
function getExportedNames(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const exports: string[] = [];

  const namedExportPattern =
    /export\s+(?:const|let|var|function|class)\s+(\w+)/g;
  let match;
  while ((match = namedExportPattern.exec(content)) !== null) {
    if (match[1]) exports.push(match[1]);
  }

  if (/export\s+default\s/.test(content)) {
    exports.push("default");
  }

  return exports;
}

// ----- Public API ------------------------------------------------------------

/**
 * Checks web bundle safety for an Expo/React Native app.
 *
 * @returns All violations found. Empty array means the bundle is safe for web.
 *
 * @example
 * ```ts
 * const result = checkWebBundleSafety({ srcDir: '/path/to/apps/mobile' });
 * if (result.violations.length > 0) {
 *   console.error('Web bundle violations:', result.violations);
 * }
 * ```
 */
export function checkWebBundleSafety(
  config: WebBundleSafetyConfig
): WebBundleSafetyResult {
  const srcDir = path.resolve(config.srcDir);
  const storesDir = path.join(srcDir, config.storesDir ?? "stores");
  const providersDir = path.join(srcDir, config.providersDir ?? "providers");
  const additionalWebDirs = (config.additionalWebDirs ?? ["components"]).map(
    (d) => path.join(srcDir, d)
  );
  const nativeOnlyPatterns = config.nativeOnlyPatterns ?? [
    /useConvexConnectionState/,
  ];

  const violations: WebBundleViolation[] = [];

  // ---- Zustand stores ----

  const storeFiles = findSourceFiles(storesDir, [".ts"]);
  const zustandStores = storeFiles.filter((f) => {
    const content = fs.readFileSync(f, "utf-8");
    return /from\s+['"]zustand/.test(content);
  });

  for (const storeFile of zustandStores) {
    const relPath = path.relative(srcDir, storeFile);
    const webFile = getWebCounterpart(storeFile);
    const webRelPath = path.relative(srcDir, webFile);

    if (!fs.existsSync(webFile)) {
      violations.push({
        file: relPath,
        issue: `Zustand store "${relPath}" has no web counterpart at "${webRelPath}".`,
        fix:
          `Create "${webRelPath}" that exports the same symbols but does NOT import from Zustand. ` +
          `Metro resolves .web.ts files automatically when bundling for web.`,
      });
      continue;
    }

    // Web file must not import Zustand
    const webContent = fs.readFileSync(webFile, "utf-8");
    if (/from\s+['"]zustand/.test(webContent)) {
      violations.push({
        file: webRelPath,
        issue: `Web counterpart "${webRelPath}" imports from Zustand.`,
        fix:
          `Remove the Zustand import. The web counterpart should provide no-op or in-memory ` +
          `implementations that don't depend on Zustand (which uses import.meta.env.MODE).`,
      });
    }

    // Export signature must match
    const nativeExports = getExportedNames(storeFile);
    const webExports = getExportedNames(webFile);
    const missing = nativeExports.filter((e) => !webExports.includes(e));
    if (missing.length > 0) {
      violations.push({
        file: webRelPath,
        issue: `Web counterpart "${webRelPath}" is missing exports: ${missing.join(", ")}.`,
        fix:
          `Add the missing exports to "${webRelPath}". Every export from the native file ` +
          `must also exist in the web counterpart (even if it's a no-op).`,
      });
    }
  }

  // ---- Native-only providers ----

  const providerFiles = findSourceFiles(providersDir, [".tsx"]);
  const nativeOnlyProviders = providerFiles.filter((f) => {
    const content = fs.readFileSync(f, "utf-8");
    return nativeOnlyPatterns.some((p) => p.test(content));
  });

  for (const providerFile of nativeOnlyProviders) {
    const relPath = path.relative(srcDir, providerFile);
    const webFile = getWebCounterpart(providerFile);
    const webRelPath = path.relative(srcDir, webFile);

    if (!fs.existsSync(webFile)) {
      violations.push({
        file: relPath,
        issue: `Native-only provider "${relPath}" has no web counterpart at "${webRelPath}".`,
        fix:
          `Create "${webRelPath}" that exports the same symbols with web-compatible implementations.`,
      });
      continue;
    }

    // Export signature must match
    const nativeExports = getExportedNames(providerFile);
    const webExports = getExportedNames(webFile);
    const missing = nativeExports.filter((e) => !webExports.includes(e));
    if (missing.length > 0) {
      violations.push({
        file: webRelPath,
        issue: `Web counterpart "${webRelPath}" is missing exports: ${missing.join(", ")}.`,
        fix:
          `Add the missing exports to "${webRelPath}". Consumers import the same symbols ` +
          `regardless of platform.`,
      });
    }
  }

  // ---- No import.meta in web files ----

  const allWebDirs = [storesDir, providersDir, ...additionalWebDirs];
  const webFiles = allWebDirs.flatMap(findWebFiles);

  for (const webFile of webFiles) {
    const content = fs.readFileSync(webFile, "utf-8");
    if (/import\.meta/.test(content)) {
      violations.push({
        file: path.relative(srcDir, webFile),
        issue: `Web file "${path.relative(srcDir, webFile)}" uses import.meta which crashes Metro web bundles.`,
        fix:
          `Replace import.meta usage with an alternative. Metro web bundles are served as ` +
          `regular <script> tags, not ES modules, so import.meta is undefined.`,
      });
    }
  }

  return { violations };
}

/**
 * Jest/Vitest-compatible test function. Throws a descriptive error if any
 * web bundle safety violations are found.
 *
 * @example
 * ```ts
 * import { testWebBundleSafety } from '@supa-media/testing';
 * test('web bundle is safe', () => testWebBundleSafety({ srcDir: 'apps/mobile' }));
 * ```
 */
export function testWebBundleSafety(config: WebBundleSafetyConfig): void {
  const result = checkWebBundleSafety(config);

  if (result.violations.length > 0) {
    const details = result.violations
      .map(
        (v) => `\n  File: ${v.file}\n  Issue: ${v.issue}\n  Fix: ${v.fix}`
      )
      .join("\n");

    throw new Error(
      `Found ${result.violations.length} web bundle safety violation(s):${details}\n\n` +
        `Background: Metro web bundles are served as regular <script> tags. ` +
        `Native-only code (Zustand v5 middleware, native modules) must have .web.ts counterparts ` +
        `that Metro resolves automatically when bundling for web.\n`
    );
  }
}
