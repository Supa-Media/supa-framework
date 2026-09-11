/**
 * Shared patterns for detecting native dependencies in package names.
 *
 * These patterns identify packages that contain native code (iOS/Android)
 * and therefore affect the native fingerprint. Used by check-native-imports
 * and available for linter rules.
 */

/**
 * Regex patterns that match native dependency package names.
 * A package matching any of these patterns is considered native.
 */
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
  /^@posthog\/react-native-plugin$/,
  /^posthog-react-native-session-replay$/,
  /^@shopify\/flash-list/,
  /^@gorhom\/bottom-sheet/,
  /^@rnmapbox\//,
  /^@mapbox\//,
];

/**
 * Regex that matches static import/export statements and captures the module specifier.
 *
 * Matches:
 *   import X from 'pkg'
 *   import { X } from 'pkg'
 *   import 'pkg'
 *   export { X } from 'pkg'
 *
 * Does NOT match:
 *   require('pkg')          (dynamic import — allowed for gated deps)
 *   import('pkg')           (dynamic import — allowed for gated deps)
 */
const STATIC_IMPORT_REGEX =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+(?:[\s\S]*?\s+from\s+)?)['"]([^'"]+)['"]/g;

/**
 * Check if a package name matches any native package pattern.
 *
 * @param {string} name - Package name to check
 * @returns {boolean}
 */
function isNativePackage(name) {
  return NATIVE_PACKAGE_PATTERNS.some((p) => p.test(name));
}

/**
 * Directories to skip when scanning source files.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "web-build",
  ".expo",
  ".next",
]);

/**
 * File extensions to scan for import statements.
 */
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx)$/;

/**
 * File patterns to exclude from scanning.
 */
const EXCLUDE_FILE_PATTERNS = /\.d\.ts$/;

module.exports = {
  NATIVE_PACKAGE_PATTERNS,
  STATIC_IMPORT_REGEX,
  SKIP_DIRS,
  SOURCE_EXTENSIONS,
  EXCLUDE_FILE_PATTERNS,
  isNativePackage,
};
