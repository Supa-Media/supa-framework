/**
 * React Resolution Tests for monorepo Expo/React Native apps.
 *
 * The hazard
 * ----------
 * An Expo/React-Native app renders against exactly one React. Every native
 * package that registers Fabric views/modules (`react-native`,
 * `expo-modules-core`, the `expo-*` / `@react-native/*` packages) is keyed to a
 * specific React at install time. If a SECOND React sneaks into the workspace —
 * classically because a web-only React library (MUI, react-datepicker, …) drags
 * its own React in via pnpm's `autoInstallPeers` — and re-keys any of those
 * native packages to that other React, Fabric view/module registration breaks
 * AT RUNTIME on the installed native binary: native video and animated GIFs
 * render blank, while typecheck, tests and the JS bundle all pass (tests mock
 * native modules; the JS bundle builds fine). This is invisible to CI unless a
 * guard like this one asserts a single React across the native graph.
 *
 * See Togather's battle-tested standalone check
 * (`apps/mobile/scripts/check-react-consistency.js`) for the reference
 * semantics: it compares the `(react@X)` peer keyed onto every native package in
 * the pnpm lockfile against the app's pinned React and fails on any mismatch.
 *
 * What this checks (and why it is linker-agnostic)
 * ------------------------------------------------
 * Older versions of this guard asserted that `react`/`react-dom` existed at
 * `apps/mobile/node_modules/react(-dom)` — an APP-LOCAL copy. That assumption is
 * wrong under pnpm's `node-linker=hoisted` (used by Metro-based apps), which
 * hoists every dependency to the workspace-root `node_modules` and never
 * produces an app-local copy. A healthy hoisted install would fail the old
 * guard, forcing a postinstall symlink hack to fake the app-local copy.
 *
 * The redesigned guard resolves React the way Node/Metro actually would and
 * compares by VERSION (not file path), which is correct for every linker:
 *
 *   1. **Native-graph single React.** Resolve `react` from the app dir and from
 *      each native package's own dir (`react-native`, `expo-modules-core`,
 *      `react-native-web`). Every one must resolve to the SAME React version the
 *      app renders with. A native package keyed to a different React is the
 *      exact runtime hazard above.
 *   2. **No duplicate React in the install.** Scan the pnpm virtual store
 *      (`node_modules/.pnpm/react@*`) — present under both the hoisted and the
 *      isolated linker — for distinct `react@<version>` entries. More than one
 *      is a second React copy in the install.
 *   3. **react / react-dom agree.** Their major.minor must match, or React and
 *      react-dom disagree on shared internals ("ReactCurrentDispatcher is
 *      undefined").
 *
 * Version is the identity, not the resolved file path: under the hoisted linker
 * pnpm hard-links the SAME `react@X` into both the top-level `node_modules/react`
 * and `.pnpm/react@X/node_modules/react`, so two healthy resolutions of one
 * React version legitimately return different paths. Comparing paths would
 * false-positive; comparing versions matches Togather's lockfile semantics.
 */

import * as fs from "fs";
import * as path from "path";

// ----- Types ----------------------------------------------------------------

export interface ReactResolutionViolation {
  issue: string;
  detail: string;
  fix: string;
}

/** Where and at what version a React was resolved from a given anchor. */
export interface ResolvedReactInfo {
  version: string;
  /** The resolved react/package.json path (through symlinks, as Node returns it). */
  resolvedPath: string;
}

export interface NativePackageReact {
  /** Native package name, e.g. "expo-modules-core". */
  name: string;
  /** React version resolved from that package's dir, or null if unresolved. */
  reactVersion: string | null;
  /** Absolute dir the package resolved to, for diagnostics. */
  packageDir: string;
}

export interface ReactResolutionResult {
  violations: ReactResolutionViolation[];
  /** The React version the app renders with (resolved from the app dir). */
  resolvedReactVersion: string | null;
  /** The react-dom version resolved from the app dir. */
  resolvedReactDomVersion: string | null;
  /** React version resolved from each checked native package. */
  nativeGraph: NativePackageReact[];
  /** Distinct react versions found in the pnpm store (duplicate detection). */
  reactVersionsInStore: string[];
}

export interface ReactResolutionOptions {
  /**
   * Native packages whose keyed React must match the app's React. These are the
   * packages that register Fabric views/modules on the installed native binary.
   * Only packages that are actually installed are checked; the rest are skipped.
   *
   * Default: `["react-native", "expo-modules-core", "react-native-web"]`.
   *
   * `react-native-web` is included because supa-framework apps render web via
   * react-native-web on the SAME React as native. A consumer that intentionally
   * runs a separate web React (a distinct web app in the monorepo) should drop
   * it from this list.
   */
  nativePackages?: string[];
}

// ----- Constants -------------------------------------------------------------

const DEFAULT_NATIVE_PACKAGES = [
  "react-native",
  "expo-modules-core",
  "react-native-web",
];

// ----- Helpers ---------------------------------------------------------------

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Resolve `<pkg>/package.json` starting the Node module-resolution walk at
 * `fromDir` (i.e. `fromDir/node_modules`, then up the tree). Returns the
 * resolved path or null if the package isn't reachable from there.
 */
function resolvePackageJson(pkg: string, fromDir: string): string | null {
  try {
    return require.resolve(`${pkg}/package.json`, { paths: [fromDir] });
  } catch {
    return null;
  }
}

/** Resolve React (version + path) as Node/Metro would from an anchor dir. */
function resolveReactFrom(fromDir: string): ResolvedReactInfo | null {
  const pkgJsonPath = resolvePackageJson("react", fromDir);
  if (!pkgJsonPath) return null;
  const json = readJson(pkgJsonPath);
  if (!json || typeof json.version !== "string") return null;
  return { version: json.version, resolvedPath: pkgJsonPath };
}

function resolveReactDomVersionFrom(fromDir: string): string | null {
  const pkgJsonPath = resolvePackageJson("react-dom", fromDir);
  if (!pkgJsonPath) return null;
  const json = readJson(pkgJsonPath);
  return json && typeof json.version === "string" ? json.version : null;
}

/** Walk up from `startDir` to find the pnpm/npm workspace root. */
function findWorkspaceRoot(startDir: string): string | null {
  let current = startDir;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(current, "lerna.json"))
    ) {
      return current;
    }
    const rootPkg = readJson(path.join(current, "package.json"));
    if (rootPkg && rootPkg.workspaces) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Distinct `react@<version>` entries in the pnpm virtual store. The `.pnpm`
 * store exists under BOTH the hoisted and isolated linkers, so this is a
 * linker-agnostic way to detect a second React copy in the install. React has
 * no peer deps, so its store dir name is a plain `react@<version>` (no peer
 * hash suffix), which makes the version trivial to extract.
 */
function reactVersionsInStore(workspaceRoot: string): string[] {
  const storeDir = path.join(workspaceRoot, "node_modules", ".pnpm");
  let entries: string[];
  try {
    entries = fs.readdirSync(storeDir);
  } catch {
    return [];
  }
  const versions = new Set<string>();
  for (const entry of entries) {
    // Match `react@1.2.3` but NOT `react-dom@…`, `react-native@…`, etc.
    const m = entry.match(/^react@(\d[^_(]*)$/);
    if (m && m[1]) versions.add(m[1]);
  }
  return [...versions].sort();
}

// ----- Public API ------------------------------------------------------------

/**
 * Checks React resolution for an Expo/React Native app. Resolves React the way
 * Node/Metro would (by version, linker-agnostic) rather than requiring an
 * app-local copy to physically exist.
 *
 * @param projectRoot - Absolute path to the app root (e.g. `/path/to/apps/mobile`).
 * @param options - Optional overrides (e.g. which native packages to check).
 *
 * @example
 * ```ts
 * const result = checkReactResolution('/path/to/apps/mobile');
 * if (result.violations.length > 0) console.error(result.violations);
 * ```
 */
export function checkReactResolution(
  projectRoot: string,
  options: ReactResolutionOptions = {}
): ReactResolutionResult {
  const appDir = path.resolve(projectRoot);
  const violations: ReactResolutionViolation[] = [];
  const nativePackages = options.nativePackages ?? DEFAULT_NATIVE_PACKAGES;

  // ---- 1. React the app renders with ----

  const appReact = resolveReactFrom(appDir);
  const resolvedReactVersion = appReact?.version ?? null;
  const resolvedReactDomVersion = resolveReactDomVersionFrom(appDir);

  if (!appReact) {
    violations.push({
      issue: "React is not resolvable from the app",
      detail: `Could not resolve \`react\` starting from ${appDir}. Node/Metro walk the node_modules hierarchy up to the workspace root, so this means React is missing from the install entirely (not merely un-hoisted).`,
      fix: `Run your package manager's install (e.g. \`pnpm install\`) and confirm \`react\` is a dependency of the app.`,
    });
  }

  // ---- 2. react / react-dom agree (major.minor) ----

  if (appReact && resolvedReactDomVersion) {
    const [rMaj, rMin] = appReact.version.split(".");
    const [dMaj, dMin] = resolvedReactDomVersion.split(".");
    if (rMaj !== dMaj || rMin !== dMin) {
      violations.push({
        issue: "react and react-dom version mismatch",
        detail: `react@${appReact.version} vs react-dom@${resolvedReactDomVersion}`,
        fix: `Ensure react and react-dom have matching major.minor versions — they share internals and a mismatch causes "ReactCurrentDispatcher is undefined".`,
      });
    }
  }

  // ---- 3. Native-graph single React ----
  // Every native package must be keyed to the SAME React version the app renders
  // with. This is the runtime hazard: a native package on a different React
  // breaks Fabric registration (blank native video/GIF) on the installed binary.

  const nativeGraph: NativePackageReact[] = [];
  for (const name of nativePackages) {
    const pkgJsonPath = resolvePackageJson(name, appDir);
    if (!pkgJsonPath) continue; // package not installed — nothing to check
    const packageDir = path.dirname(pkgJsonPath);
    const reactFromPkg = resolveReactFrom(packageDir);
    nativeGraph.push({
      name,
      reactVersion: reactFromPkg?.version ?? null,
      packageDir,
    });

    if (appReact && reactFromPkg && reactFromPkg.version !== appReact.version) {
      violations.push({
        issue: `Native package "${name}" is keyed to a different React`,
        detail: `The app renders with react@${appReact.version}, but ${name} resolves react@${reactFromPkg.version} (from ${reactFromPkg.resolvedPath}). A native package on a second React re-keys the Expo native-module graph and breaks Fabric view/module registration on the installed binary — native video and animated GIFs render blank — while typecheck, tests and the JS bundle all pass.`,
        fix: `A second React entered the install (usually a web-only React library dragging its own React in via pnpm's autoInstallPeers). Find and remove/isolate it, or pin React in the root package.json: "pnpm": { "overrides": { "react": "${appReact.version}", "react-dom": "${appReact.version}" } }, then reinstall.`,
      });
    }
  }

  // ---- 4. No duplicate React copies in the install ----

  const workspaceRoot = findWorkspaceRoot(appDir);
  const storeVersions = workspaceRoot ? reactVersionsInStore(workspaceRoot) : [];
  // Fold in every React version we actually resolved, in case the store scan
  // can't see it (e.g. a non-pnpm layout).
  const allVersions = new Set<string>(storeVersions);
  if (appReact) allVersions.add(appReact.version);
  for (const n of nativeGraph) if (n.reactVersion) allVersions.add(n.reactVersion);
  const reactVersionsFound = [...allVersions].sort();

  if (reactVersionsFound.length > 1) {
    violations.push({
      issue: "More than one React version is installed",
      detail: `Found react versions: ${reactVersionsFound.join(", ")}. An Expo/React Native app must render against exactly one React; a second copy re-keys the native module graph and breaks native Fabric rendering.`,
      fix: `Identify the dependency that pulled the extra React (often a web-only React library via pnpm's autoInstallPeers) and remove/isolate it, or pin React via root package.json pnpm.overrides, then reinstall so the store holds a single react@<version>.`,
    });
  }

  return {
    violations,
    resolvedReactVersion,
    resolvedReactDomVersion,
    nativeGraph,
    reactVersionsInStore: storeVersions,
  };
}

/**
 * Jest/Vitest-compatible test function. Throws a descriptive error if any React
 * resolution issue is found.
 *
 * @param projectRoot - Absolute path to the app root.
 * @param options - Optional overrides (e.g. which native packages to check).
 *
 * @example
 * ```ts
 * import { testReactResolution } from '@supa-media/testing';
 * test('react resolution', () => testReactResolution('/path/to/apps/mobile'));
 * ```
 */
export function testReactResolution(
  projectRoot: string,
  options?: ReactResolutionOptions
): void {
  const result = checkReactResolution(projectRoot, options);

  if (result.violations.length > 0) {
    const details = result.violations
      .map((v) => `\n  Issue: ${v.issue}\n  Detail: ${v.detail}\n  Fix: ${v.fix}`)
      .join("\n");

    throw new Error(
      `Found ${result.violations.length} React resolution issue(s):${details}\n\n` +
        `An Expo/React Native app must render against a single React, and every ` +
        `native package (react-native, expo-modules-core, react-native-web) must ` +
        `be keyed to that same React. A second React re-keys the native module ` +
        `graph and breaks Fabric rendering on the installed binary (blank native ` +
        `video/GIF) while typecheck, tests and the JS bundle all pass.\n`
    );
  }
}
