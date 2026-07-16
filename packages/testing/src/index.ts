/**
 * @supa-media/testing — Reusable test suites that catch common Expo/React Native gotchas.
 *
 * Provides both programmatic APIs (for custom integration) and Jest/Vitest-compatible
 * test factories (for drop-in usage in test files).
 *
 * @example
 * ```ts
 * // Quick setup — drop into any test file:
 * import { createSupaTests } from '@supa-media/testing';
 *
 * const { routingConflicts, webBundleSafety, reactResolution } = createSupaTests({
 *   appDir: 'apps/mobile/app',
 *   srcDir: 'apps/mobile',
 * });
 *
 * describe('Supa Framework Tests', () => {
 *   test('no routing conflicts', routingConflicts);
 *   test('web bundle safety', webBundleSafety);
 *   test('react resolution', reactResolution);
 * });
 * ```
 */

import * as path from "path";

// Import for internal use in createSupaTests / runAllSupaTests
import { testRoutingConflicts as _testRoutingConflicts } from "./routing-conflicts";
import { testWebBundleSafety as _testWebBundleSafety } from "./web-bundle-safety";
import { testReactResolution as _testReactResolution } from "./react-resolution";
import { testNativeImports as _testNativeImports } from "./native-import-check";

// Re-export everything from each module
export {
  detectRoutingConflicts,
  testRoutingConflicts,
  type RouteConflict,
  type MissingLayout,
  type RoutingConflictResult,
} from "./routing-conflicts";

export {
  checkWebBundleSafety,
  testWebBundleSafety,
  type WebBundleSafetyConfig,
  type WebBundleViolation,
  type WebBundleSafetyResult,
} from "./web-bundle-safety";

export {
  checkReactResolution,
  testReactResolution,
  type ReactResolutionViolation,
  type ReactResolutionResult,
} from "./react-resolution";

export {
  checkNativeImports,
  testNativeImports,
  type NativeImportCheckConfig,
  type NativeImportViolation,
  type UnclassifiedDependency,
  type NativeImportCheckResult,
} from "./native-import-check";

// ----- Test factory ----------------------------------------------------------

export interface CreateSupaTestsConfig {
  /** Path to the Expo Router app/ directory (absolute or relative to cwd) */
  appDir: string;
  /** Path to the app source root (absolute or relative to cwd) */
  srcDir: string;
  /** Path to native-deps.json (relative to srcDir). Default: "native-deps.json" */
  nativeDepsPath?: string;
  /** Files allowed to statically import gated deps (relative to srcDir) */
  nativeImportAllowlist?: string[];
  /** Subdirectory containing Zustand stores (relative to srcDir). Default: "stores" */
  storesDir?: string;
  /** Subdirectory containing providers (relative to srcDir). Default: "providers" */
  providersDir?: string;
  /** Regex patterns identifying native-only imports in providers */
  nativeOnlyPatterns?: RegExp[];
  /**
   * Native packages whose keyed React must match the app's React (react-resolution suite).
   * Default: ["react-native", "expo-modules-core", "react-native-web"].
   */
  reactNativePackages?: string[];
}

export interface SupaTests {
  /** Test function: throws if routing conflicts are found */
  routingConflicts: () => void;
  /** Test function: throws if web bundle safety violations are found */
  webBundleSafety: () => void;
  /** Test function: throws if React resolution issues are found */
  reactResolution: () => void;
  /** Test function: throws if native import violations are found. Only available if nativeDepsPath exists. */
  nativeImports: () => void;
}

/**
 * Creates Jest/Vitest-compatible test functions for all Supa test suites.
 *
 * Each returned function can be passed directly to `test()` or `it()`.
 * When a test fails, it throws a descriptive error explaining what went wrong
 * and how to fix it.
 *
 * @example
 * ```ts
 * import { createSupaTests } from '@supa-media/testing';
 *
 * const tests = createSupaTests({
 *   appDir: 'apps/mobile/app',
 *   srcDir: 'apps/mobile',
 *   nativeDepsPath: 'native-deps.json',
 *   nativeImportAllowlist: ['features/chat/utils/fileTypes.ts'],
 * });
 *
 * describe('Supa Framework Tests', () => {
 *   test('no routing conflicts', tests.routingConflicts);
 *   test('web bundle safety', tests.webBundleSafety);
 *   test('react resolution', tests.reactResolution);
 *   test('no ungated native imports', tests.nativeImports);
 * });
 * ```
 */
export function createSupaTests(config: CreateSupaTestsConfig): SupaTests {
  const resolvedAppDir = path.resolve(config.appDir);
  const resolvedSrcDir = path.resolve(config.srcDir);

  return {
    routingConflicts: () => _testRoutingConflicts(resolvedAppDir),

    webBundleSafety: () =>
      _testWebBundleSafety({
        srcDir: resolvedSrcDir,
        storesDir: config.storesDir,
        providersDir: config.providersDir,
        nativeOnlyPatterns: config.nativeOnlyPatterns,
      }),

    reactResolution: () =>
      _testReactResolution(resolvedSrcDir, {
        nativePackages: config.reactNativePackages,
      }),

    nativeImports: () =>
      _testNativeImports({
        srcDir: resolvedSrcDir,
        nativeDepsPath: config.nativeDepsPath,
        allowlist: config.nativeImportAllowlist,
      }),
  };
}

// ----- Run all ---------------------------------------------------------------

export interface RunAllConfig extends CreateSupaTestsConfig {}

export interface RunAllResult {
  passed: string[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Runs all Supa test suites and returns a summary. Does not throw —
 * useful for CI scripts that want to collect all failures before exiting.
 *
 * @example
 * ```ts
 * import { runAllSupaTests } from '@supa-media/testing';
 *
 * const result = runAllSupaTests({
 *   appDir: 'apps/mobile/app',
 *   srcDir: 'apps/mobile',
 * });
 *
 * if (result.failed.length > 0) {
 *   console.error('Tests failed:', result.failed);
 *   process.exit(1);
 * }
 * ```
 */
export function runAllSupaTests(config: RunAllConfig): RunAllResult {
  const tests = createSupaTests(config);
  const passed: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  const suites: Array<[string, () => void]> = [
    ["routing-conflicts", tests.routingConflicts],
    ["web-bundle-safety", tests.webBundleSafety],
    ["react-resolution", tests.reactResolution],
    ["native-imports", tests.nativeImports],
  ];

  for (const [name, fn] of suites) {
    try {
      fn();
      passed.push(name);
    } catch (err: unknown) {
      failed.push({
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { passed, failed };
}
