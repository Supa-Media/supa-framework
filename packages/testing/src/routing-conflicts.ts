/**
 * Routing Conflict Detector for Expo Router apps.
 *
 * Expo Router uses file-based routing where route groups (directories wrapped in
 * parentheses like `(user)` or `(admin)`) do NOT affect the resolved URL. This
 * means `app/(user)/settings/index.tsx` and `app/(admin)/settings/index.tsx` both
 * resolve to `/settings` and will conflict at runtime.
 *
 * This module detects:
 * - Multiple routes resolving to the same URL
 * - Dynamic routes conflicting with static routes at the same level
 * - Missing `_layout.tsx` files in nested directories (can cause navigation crashes)
 */

import * as fs from "fs";
import * as path from "path";

// ----- Types ----------------------------------------------------------------

export interface RouteConflict {
  /** The URL pattern that multiple routes resolve to (e.g. "/settings") */
  url: string;
  /** File paths (relative to appDir) that all resolve to this URL */
  files: string[];
  /** Human-readable description of the conflict and how to fix it */
  description: string;
}

export interface MissingLayout {
  /** Directory path (relative to appDir) that is missing a _layout.tsx */
  directory: string;
  /** Human-readable description */
  description: string;
}

export interface RoutingConflictResult {
  /** URL conflicts — multiple files resolving to the same URL */
  conflicts: RouteConflict[];
  /** Directories with route files but no _layout.tsx */
  missingLayouts: MissingLayout[];
}

// ----- Non-route directories to skip ----------------------------------------

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "__tests__",
  "components",
  "providers",
  "services",
  "utils",
  "hooks",
  "types",
  "config",
  "constants",
  "features",
  "dist",
  "venv",
  "ios",
  "android",
  ".git",
]);

// ----- File system helpers ---------------------------------------------------

/**
 * Recursively collects all .tsx/.ts files in the given directory,
 * skipping non-route directories.
 */
function getAllRouteFiles(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        results.push(...getAllRouteFiles(fullPath));
      }
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

// ----- Route analysis helpers ------------------------------------------------

/**
 * Converts an absolute file path to the URL it resolves to in Expo Router.
 *
 * 1. Strips the appDir prefix
 * 2. Removes route groups — `(name)/` segments are stripped
 * 3. Converts `index.tsx` to the directory URL
 * 4. Replaces `[param]` with `:param` for pattern matching
 */
function resolveRouteToUrl(filePath: string, appDir: string): string {
  let rel = filePath.replace(appDir, "").replace(/\\/g, "/");
  if (rel.startsWith("/")) rel = rel.substring(1);

  // Strip route groups
  rel = rel.replace(/\([^)]+\)\//g, "");
  rel = rel.replace(/\([^)]+\)/g, "");

  // Handle index files
  if (rel.endsWith("/index.tsx") || rel.endsWith("/index.ts")) {
    rel = rel.replace(/\/index\.(tsx|ts)$/, "");
  } else {
    rel = rel.replace(/\.(tsx|ts)$/, "");
  }

  // Dynamic segments → :param
  rel = rel.replace(/\[([^\]]+)\]/g, ":$1");

  if (!rel.startsWith("/")) rel = "/" + rel;
  if (rel !== "/" && rel.endsWith("/")) rel = rel.slice(0, -1);

  return rel || "/";
}

/**
 * Extracts route group names from a file path.
 * `app/(user)/(tabs)/profile/index.tsx` → `["user", "tabs"]`
 */
function extractRouteGroups(filePath: string, appDir: string): string[] {
  const rel = filePath.replace(appDir, "").replace(/\\/g, "/");
  const matches = rel.match(/\(([^)]+)\)/g);
  return matches ? matches.map((m) => m.replace(/[()]/g, "")) : [];
}

function isLayoutFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === "_layout.tsx" || base === "_layout.ts";
}

function isSpecialFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base.startsWith("+");
}

function isDynamicRoute(filePath: string): boolean {
  return /\[.*\]/.test(filePath);
}

/**
 * Checks if a file is a redirect-only route (contains only a `<Redirect>` component).
 * Redirect files don't create real routes so they're excluded from conflict detection.
 */
function isRedirectFile(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const hasRedirect = /<Redirect\s+href/.test(content) || /Redirect\s+href/.test(content);
    if (!hasRedirect) return false;
    // Strip imports and the redirect function — if almost nothing is left, it's redirect-only
    const stripped = content
      .replace(/import\s+.*?from\s+['"].*?['"];?\s*/g, "")
      .replace(
        /export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?return\s+<Redirect[^>]*\/>[\s\S]*?\}/g,
        ""
      )
      .replace(
        /export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?return\s+<Redirect[^>]*>[\s\S]*?<\/Redirect>[\s\S]*?\}/g,
        ""
      )
      .trim();
    return stripped.length < 50;
  } catch {
    return false;
  }
}

/**
 * Checks if a file is a simple re-export (e.g. `export { default } from "@/app/..."`).
 * Re-exports intentionally duplicate a route into another route group context.
 */
function isReexportFile(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line: string) => {
      const t = line.trim();
      return t && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*");
    });
    if (lines.length !== 1) return false;
    return /export\s*\{\s*default\s*\}\s*from/.test(content);
  } catch {
    return false;
  }
}

// ----- Public API ------------------------------------------------------------

/**
 * Scans an Expo Router `app/` directory and returns all detected routing issues.
 *
 * @param appDir - Absolute path to the Expo Router `app/` directory
 * @returns Detected conflicts and missing layouts
 *
 * @example
 * ```ts
 * const result = detectRoutingConflicts('/path/to/apps/mobile/app');
 * if (result.conflicts.length > 0) {
 *   console.error('Route conflicts found:', result.conflicts);
 * }
 * ```
 */
export function detectRoutingConflicts(appDir: string): RoutingConflictResult {
  const resolved = path.resolve(appDir);
  const allFiles = getAllRouteFiles(resolved);

  // Filter to actual route files
  const routeFiles = allFiles.filter((f) => {
    if (isLayoutFile(f) || isSpecialFile(f)) return false;
    const rel = f.replace(resolved, "");
    return (
      rel.endsWith("/index.tsx") ||
      rel.endsWith("/index.ts") ||
      (!rel.includes("/index.") && (rel.endsWith(".tsx") || rel.endsWith(".ts")))
    );
  });

  // ---- URL conflict detection ----

  const urlToFiles = new Map<string, string[]>();
  for (const file of routeFiles) {
    const url = resolveRouteToUrl(file, resolved);
    if (!urlToFiles.has(url)) urlToFiles.set(url, []);
    urlToFiles.get(url)!.push(file);
  }

  const conflicts: RouteConflict[] = [];

  for (const [url, files] of urlToFiles) {
    // Re-exports are intentional duplicates (a route deliberately surfaced in
    // another group), so they're excluded. Redirect-only files are NOT excluded:
    // a redirect that shares a URL with a real route SHADOWS it at runtime — the
    // exact, hard-to-spot bug where e.g. `app/index.tsx` (a <Redirect>) collides
    // with `app/(app)/(tabs)/index.tsx` and hides the real screen.
    const actual = files.filter((f) => !isReexportFile(f));
    if (actual.length <= 1) continue;
    const involvesRedirect = actual.some((f) => isRedirectFile(f));

    // Compare each pair
    for (let i = 0; i < actual.length; i++) {
      for (let j = i + 1; j < actual.length; j++) {
        const groups1 = extractRouteGroups(actual[i]!, resolved);
        const groups2 = extractRouteGroups(actual[j]!, resolved);
        const sameGroups =
          groups1.length === groups2.length &&
          groups1.every((g, idx) => g === groups2[idx]);

        if (!sameGroups) {
          const relFiles = actual.map((f) => f.replace(resolved, ""));
          const existing = conflicts.find((c) => c.url === url);
          if (!existing) {
            conflicts.push({
              url,
              files: relFiles,
              description:
                `Multiple routes resolve to "${url}". ` +
                `In Expo Router, route groups (parentheses) don't affect the URL. ` +
                `Files: ${relFiles.join(", ")}. ` +
                (involvesRedirect
                  ? `One of these is a <Redirect> file — it will SHADOW the real ` +
                    `screen at this URL (the redirect renders instead). Move the ` +
                    `redirect logic into a layout guard, or give the screen a ` +
                    `unique path. `
                  : "") +
                `Fix: rename one route to a unique URL path, or consolidate into a single route.`,
            });
          }
          break;
        }
      }
    }
  }

  // ---- Dynamic vs static conflict detection ----

  const routeDetails = routeFiles.map((f) => ({
    file: f,
    url: resolveRouteToUrl(f, resolved),
    isDynamic: isDynamicRoute(f),
  }));

  const statics = routeDetails.filter((r) => !r.isDynamic);
  const dynamics = routeDetails.filter((r) => r.isDynamic);

  for (const s of statics) {
    for (const d of dynamics) {
      const sNorm = s.url.replace(/:\w+/g, "*");
      const dNorm = d.url.replace(/:\w+/g, "*");
      if (sNorm === dNorm && s.url !== d.url) {
        const sSegs = s.url.split("/").filter(Boolean).length;
        const dSegs = d.url.split("/").filter(Boolean).length;
        if (sSegs === dSegs) {
          conflicts.push({
            url: s.url,
            files: [s.file.replace(resolved, ""), d.file.replace(resolved, "")],
            description:
              `Static route "${s.url}" conflicts with dynamic route "${d.url}" at the same depth. ` +
              `This can cause ambiguous matching at runtime.`,
          });
        }
      }
    }
  }

  // ---- Missing _layout.tsx detection ----

  const missingLayouts: MissingLayout[] = [];
  const dirsWithRoutes = new Set<string>();

  for (const file of routeFiles) {
    dirsWithRoutes.add(path.dirname(file));
  }

  for (const dir of dirsWithRoutes) {
    // Skip the appDir itself (root _layout is often present but not required by this check)
    if (dir === resolved) continue;

    const layoutExists =
      fs.existsSync(path.join(dir, "_layout.tsx")) ||
      fs.existsSync(path.join(dir, "_layout.ts"));

    if (!layoutExists) {
      const relDir = dir.replace(resolved, "") || "/";
      missingLayouts.push({
        directory: relDir,
        description:
          `Directory "${relDir}" contains route files but has no _layout.tsx. ` +
          `Without a layout, Expo Router may flatten child routes or cause ` +
          `"Maximum update depth exceeded" crashes due to mismatched navigator screen names. ` +
          `Add a _layout.tsx with the appropriate Stack/Tabs navigator.`,
      });
    }
  }

  return { conflicts, missingLayouts };
}

/**
 * Jest/Vitest-compatible test function that throws descriptive errors on failure.
 *
 * @param appDir - Absolute path to the Expo Router `app/` directory
 *
 * @example
 * ```ts
 * import { testRoutingConflicts } from '@supa-media/testing';
 * test('no routing conflicts', () => testRoutingConflicts('/path/to/app'));
 * ```
 */
export function testRoutingConflicts(appDir: string): void {
  const result = detectRoutingConflicts(appDir);

  if (result.conflicts.length > 0) {
    const details = result.conflicts
      .map(
        (c) =>
          `\n  URL: ${c.url}\n  Files: ${c.files.join("\n         ")}\n  ${c.description}`
      )
      .join("\n");

    throw new Error(
      `Found ${result.conflicts.length} routing conflict(s):${details}\n\n` +
        `Solutions:\n` +
        `  1. Rename one of the conflicting routes to a unique URL path\n` +
        `  2. Use different URL segments (e.g. /admin/settings vs /user/settings)\n` +
        `  3. Consolidate duplicate routes into a single file with route guards\n`
    );
  }

  if (result.missingLayouts.length > 0) {
    const details = result.missingLayouts
      .map((m) => `\n  Directory: ${m.directory}\n  ${m.description}`)
      .join("\n");

    throw new Error(
      `Found ${result.missingLayouts.length} directory(ies) missing _layout.tsx:${details}\n\n` +
        `Each directory with route files needs a _layout.tsx to define its navigator.\n` +
        `Without it, Expo Router may flatten routes and cause navigation crashes.\n`
    );
  }
}
