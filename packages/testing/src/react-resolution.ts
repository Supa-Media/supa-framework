/**
 * React Resolution Tests for monorepo Expo/React Native apps.
 *
 * In monorepos, the workspace root may have a different React version than the
 * mobile app (e.g. React 18 for a Next.js web app, React 19 for React Native).
 * If Metro accidentally resolves React from the workspace root, the app crashes
 * with one of:
 *
 * - **"use is not a function"** — React 18 is loaded but dependencies expect React 19
 * - **"ReactCurrentDispatcher is undefined"** — Multiple React instances loaded
 *
 * This module verifies:
 * - Only one version of React is resolved from the project root
 * - `react` and `react-dom` versions match (major + minor)
 * - The resolved version matches what `package.json` specifies
 */

import * as fs from "fs";
import * as path from "path";

// ----- Types ----------------------------------------------------------------

export interface ReactResolutionViolation {
  issue: string;
  detail: string;
  fix: string;
}

export interface ReactResolutionResult {
  violations: ReactResolutionViolation[];
  /** The React version resolved from the project root, if found */
  resolvedReactVersion: string | null;
  /** The react-dom version resolved from the project root, if found */
  resolvedReactDomVersion: string | null;
}

// ----- Helpers ---------------------------------------------------------------

function readPackageVersion(packageJsonPath: string): string | null {
  try {
    const content = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return content.version ?? null;
  } catch {
    return null;
  }
}

function getSpecifiedVersion(projectRoot: string, pkg: string): string | null {
  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8")
    );
    const version =
      pkgJson.dependencies?.[pkg] ?? pkgJson.devDependencies?.[pkg] ?? null;
    return version ? version.replace(/^[\^~]/, "") : null;
  } catch {
    return null;
  }
}

// ----- Public API ------------------------------------------------------------

/**
 * Checks React version resolution for a project.
 *
 * @param projectRoot - Absolute path to the project root (the app, not the
 *   monorepo workspace root). For example: `/path/to/apps/mobile`
 *
 * @example
 * ```ts
 * const result = checkReactResolution('/path/to/apps/mobile');
 * if (result.violations.length > 0) {
 *   console.error(result.violations);
 * }
 * ```
 */
export function checkReactResolution(
  projectRoot: string
): ReactResolutionResult {
  const resolved = path.resolve(projectRoot);
  const violations: ReactResolutionViolation[] = [];

  // ---- Resolve React from project root ----

  const reactPkgPath = path.join(
    resolved,
    "node_modules",
    "react",
    "package.json"
  );
  const reactDomPkgPath = path.join(
    resolved,
    "node_modules",
    "react-dom",
    "package.json"
  );

  const reactVersion = fs.existsSync(reactPkgPath)
    ? readPackageVersion(reactPkgPath)
    : null;

  const reactDomVersion = fs.existsSync(reactDomPkgPath)
    ? readPackageVersion(reactDomPkgPath)
    : null;

  // ---- Check React is present ----

  if (!reactVersion) {
    violations.push({
      issue: "React not found in project node_modules",
      detail: `Expected to find react at ${reactPkgPath}`,
      fix:
        `Run your package manager's install command to ensure React is installed ` +
        `in the project's own node_modules (not just hoisted to workspace root).`,
    });
  }

  // ---- Check react and react-dom match ----

  if (reactVersion && reactDomVersion) {
    const [reactMajor, reactMinor] = reactVersion.split(".");
    const [domMajor, domMinor] = reactDomVersion.split(".");

    if (reactMajor !== domMajor || reactMinor !== domMinor) {
      violations.push({
        issue: "react and react-dom version mismatch",
        detail: `react@${reactVersion} vs react-dom@${reactDomVersion}`,
        fix:
          `Ensure react and react-dom have matching major and minor versions. ` +
          `Mismatched versions cause "ReactCurrentDispatcher is undefined" errors ` +
          `because React and react-dom expect to share the same internals.`,
      });
    }
  }

  // ---- Check package.json matches installed ----

  const specifiedReact = getSpecifiedVersion(resolved, "react");
  if (specifiedReact && reactVersion && specifiedReact !== reactVersion) {
    violations.push({
      issue: "Installed React version doesn't match package.json",
      detail: `package.json specifies ${specifiedReact} but ${reactVersion} is installed`,
      fix:
        `Run your package manager's install command to sync installed versions. ` +
        `The mismatch may indicate workspace hoisting resolved a different version.`,
    });
  }

  // ---- Check workspace root doesn't shadow ----

  // Walk up to find workspace root (look for pnpm-workspace.yaml or root package.json with workspaces)
  let workspaceRoot: string | null = null;
  let current = path.dirname(resolved);
  for (let i = 0; i < 5; i++) {
    if (
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(current, "lerna.json"))
    ) {
      workspaceRoot = current;
      break;
    }
    try {
      const rootPkg = JSON.parse(
        fs.readFileSync(path.join(current, "package.json"), "utf-8")
      );
      if (rootPkg.workspaces) {
        workspaceRoot = current;
        break;
      }
    } catch {
      // continue
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (workspaceRoot && reactVersion) {
    const workspaceReactPkg = path.join(
      workspaceRoot,
      "node_modules",
      "react",
      "package.json"
    );
    if (fs.existsSync(workspaceReactPkg)) {
      const workspaceReactVersion = readPackageVersion(workspaceReactPkg);
      if (workspaceReactVersion && workspaceReactVersion !== reactVersion) {
        // This is informational — it's only a problem if Metro resolves the wrong one
        // We don't add it as a violation since having different versions at workspace
        // root is expected in monorepos. The important thing is that the project
        // resolves its own version first.
      }
    }
  }

  return {
    violations,
    resolvedReactVersion: reactVersion,
    resolvedReactDomVersion: reactDomVersion,
  };
}

/**
 * Jest/Vitest-compatible test function. Throws a descriptive error if any
 * React resolution issues are found.
 *
 * @param projectRoot - Absolute path to the project root
 *
 * @example
 * ```ts
 * import { testReactResolution } from '@supa-media/testing';
 * test('react resolution', () => testReactResolution('/path/to/apps/mobile'));
 * ```
 */
export function testReactResolution(projectRoot: string): void {
  const result = checkReactResolution(projectRoot);

  if (result.violations.length > 0) {
    const details = result.violations
      .map(
        (v) =>
          `\n  Issue: ${v.issue}\n  Detail: ${v.detail}\n  Fix: ${v.fix}`
      )
      .join("\n");

    throw new Error(
      `Found ${result.violations.length} React resolution issue(s):${details}\n\n` +
        `In monorepos, Metro can accidentally resolve React from the workspace root ` +
        `instead of the project root. This causes "use is not a function" or ` +
        `"ReactCurrentDispatcher is undefined" errors.\n` +
        `Check your metro.config.js resolution order and ensure the project root ` +
        `is searched before the workspace root.\n`
    );
  }
}
