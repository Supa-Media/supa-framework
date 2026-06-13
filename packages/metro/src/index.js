// @ts-check
"use strict";

const path = require("path");
const fs = require("fs");

/**
 * Find the monorepo root by walking up from projectRoot looking for
 * a pnpm-workspace.yaml or a root package.json with "workspaces".
 */
function findWorkspaceRoot(projectRoot) {
  let dir = projectRoot;
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return dir;
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume two levels up (apps/mobile -> root)
  return path.resolve(projectRoot, "../..");
}

/**
 * Resolve a workspace package to its source directory.
 * Looks at the package's package.json "exports" and "main" fields,
 * falling back to src/ directory.
 */
function resolveSharedPackage(workspaceRoot, packageName) {
  // Try to find the package in the workspace
  const packagesDir = path.join(workspaceRoot, "packages");
  if (!fs.existsSync(packagesDir)) return null;

  // Derive folder name from scoped package name (e.g., @myapp/shared -> shared)
  const folderName = packageName.replace(/^@[^/]+\//, "");
  const packageDir = path.join(packagesDir, folderName);

  if (!fs.existsSync(packageDir)) return null;
  return packageDir;
}

/**
 * Build a resolveRequest function that handles shared workspace packages.
 * Resolves imports like "@myapp/shared/foo/bar" using the package's
 * package.json exports map or falling back to src/.
 */
function buildSharedPackageResolver(workspaceRoot, sharedPackages) {
  const packageDirs = {};
  for (const pkg of sharedPackages) {
    const dir = resolveSharedPackage(workspaceRoot, pkg);
    if (dir) packageDirs[pkg] = dir;
  }

  if (Object.keys(packageDirs).length === 0) return null;

  return function resolveSharedPackages(context, moduleName, platform) {
    for (const [pkg, pkgDir] of Object.entries(packageDirs)) {
      if (moduleName !== pkg && !moduleName.startsWith(pkg + "/")) continue;

      const packageJsonPath = path.join(pkgDir, "package.json");
      if (!fs.existsSync(packageJsonPath)) continue;

      try {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf-8")
        );
        const exports = packageJson.exports || {};

        // Build the subpath: "@myapp/shared/foo" -> "./foo", "@myapp/shared" -> "."
        let subpath = moduleName.replace(pkg, "") || ".";
        if (subpath.startsWith("/")) subpath = "." + subpath;
        else if (subpath === "") subpath = ".";

        const exportConfig = exports[subpath];
        if (exportConfig) {
          let targetPath;
          if (typeof exportConfig === "string") {
            targetPath = exportConfig;
          } else if (exportConfig.default) {
            targetPath = exportConfig.default;
          } else if (exportConfig.types) {
            targetPath = exportConfig.types;
          }

          if (targetPath) {
            const resolved = resolveFileOrDir(path.resolve(pkgDir, targetPath));
            if (resolved) return { type: "sourceFile", filePath: resolved };
          }
        }

        // Fallback: resolve from src/
        const originalSubpath = moduleName.replace(pkg, "");
        const subpathClean = originalSubpath.replace(/^\//, "");
        const srcBase = path.join(pkgDir, "src");
        const resolved = resolveFileOrDir(
          path.join(srcBase, subpathClean || "index.ts")
        );
        if (resolved) return { type: "sourceFile", filePath: resolved };
      } catch (error) {
        console.warn(
          `[@supa-media/metro] Failed to resolve ${moduleName} from ${pkg}:`,
          error.message
        );
      }
    }

    return null; // Signal: not handled
  };
}

/**
 * Given a path, resolve it to an actual file:
 * - If it's a file, return it
 * - If it's a directory, try index.ts inside it
 * - If neither, try adding .ts or .tsx extensions
 */
function resolveFileOrDir(filePath) {
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    if (stats.isFile()) return filePath;
    if (stats.isDirectory()) {
      const indexTs = path.join(filePath, "index.ts");
      if (fs.existsSync(indexTs)) return indexTs;
      const indexTsx = path.join(filePath, "index.tsx");
      if (fs.existsSync(indexTsx)) return indexTsx;
      return null;
    }
  }
  // Try adding extensions
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const withExt = filePath + ext;
    if (fs.existsSync(withExt)) return withExt;
  }
  return null;
}

/**
 * Creates a complete Metro config for a pnpm monorepo with Expo.
 *
 * Handles symlink support, workspace watchFolders, nodeModulesPaths ordering,
 * shared package resolution, and optional NativeWind/Sentry wrapping.
 *
 * @param {import('./index').MetroConfigOptions} options
 * @returns {object} Metro config
 */
function createMetroConfig(options) {
  const {
    projectRoot,
    sharedPackages = [],
    withNativeWind: enableNativeWind = false,
    withSentry: enableSentry = false,
    extend,
  } = options;

  const workspaceRoot = findWorkspaceRoot(projectRoot);

  // Get base config from Sentry or Expo
  let config;
  if (enableSentry) {
    try {
      const { getSentryExpoConfig } = require("@sentry/react-native/metro");
      config = getSentryExpoConfig(projectRoot);
    } catch (e) {
      console.warn(
        "[@supa-media/metro] @sentry/react-native not found, falling back to @expo/metro-config"
      );
      const { getDefaultConfig } = require("expo/metro-config");
      config = getDefaultConfig(projectRoot);
    }
  } else {
    const { getDefaultConfig } = require("expo/metro-config");
    config = getDefaultConfig(projectRoot);
  }

  // --- watchFolders ---
  // Include workspace root and any shared packages
  const watchFolders = [
    ...(config.watchFolders || []),
    workspaceRoot,
  ];

  for (const pkg of sharedPackages) {
    const pkgDir = resolveSharedPackage(workspaceRoot, pkg);
    if (pkgDir) watchFolders.push(pkgDir);
  }

  // Include pnpm store so Metro can watch files resolved from symlinks
  const pnpmStore = path.resolve(workspaceRoot, "node_modules/.pnpm");
  if (fs.existsSync(pnpmStore)) watchFolders.push(pnpmStore);

  config.watchFolders = watchFolders.filter(
    (folder) => fs.existsSync(folder)
  );

  // --- resolver ---
  const existingResolveRequest = config.resolver.resolveRequest;
  const sharedResolver = sharedPackages.length > 0
    ? buildSharedPackageResolver(workspaceRoot, sharedPackages)
    : null;

  // Build extraNodeModules for shared packages
  const extraNodeModules = { ...config.resolver.extraNodeModules };
  for (const pkg of sharedPackages) {
    const pkgDir = resolveSharedPackage(workspaceRoot, pkg);
    if (pkgDir) {
      const srcDir = path.join(pkgDir, "src");
      extraNodeModules[pkg] = fs.existsSync(srcDir) ? srcDir : pkgDir;
    }
  }

  config.resolver = {
    ...config.resolver,
    // pnpm symlink support
    unstable_enableSymlinks: true,
    // Disable hierarchical lookup so Metro doesn't walk up from symlinked packages
    disableHierarchicalLookup: true,
    // Project node_modules first, then workspace root
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
    extraNodeModules,
    resolveRequest: sharedResolver
      ? (context, moduleName, platform) => {
          // Try shared package resolver first
          const result = sharedResolver(context, moduleName, platform);
          if (result) return result;

          // Fall back to existing resolver or default
          if (existingResolveRequest) {
            return existingResolveRequest(context, moduleName, platform);
          }
          return context.resolveRequest(context, moduleName, platform);
        }
      : existingResolveRequest,
  };

  // --- apply extend callback ---
  if (extend) {
    config = extend(config);
  }

  // --- NativeWind wrapping ---
  if (enableNativeWind) {
    try {
      const { withNativeWind: wrapNativeWind } = require("nativewind/metro");
      config = wrapNativeWind(config, { input: "./global.css" });
    } catch (e) {
      console.warn(
        "[@supa-media/metro] nativewind not found, skipping NativeWind wrapping"
      );
    }
  }

  return config;
}

module.exports = { createMetroConfig };
