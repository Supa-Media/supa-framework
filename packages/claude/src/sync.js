#!/usr/bin/env node

/**
 * @supa-media/claude sync
 *
 * Syncs Claude Code configuration templates into a Supa app's .claude/ directory
 * and generates CLAUDE.md from the template with app-specific values.
 *
 * Usage:
 *   npx @supa-media/claude sync
 *   npx @supa-media/claude sync --force   # overwrite existing files without prompting
 *   npx @supa-media/claude sync --dry-run # show what would be changed without writing
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, "..", "templates");

// --- Helpers ---

function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return null;
}

function loadSupaConfig(projectRoot) {
  // Try loading supa.config.ts values. Since we can't import TS directly,
  // we parse the file for common values as a best-effort approach.
  const configPaths = [
    join(projectRoot, "supa.config.ts"),
    join(projectRoot, "supa.config.js"),
    join(projectRoot, "supa.config.mjs"),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      return parseSupaConfig(content);
    }
  }

  // Fall back to package.json for app name
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return {
      appName: pkg.name || "my-supa-app",
      appDisplayName: pkg.name || "My Supa App",
    };
  }

  return { appName: "my-supa-app", appDisplayName: "My Supa App" };
}

function parseSupaConfig(content) {
  const config = {};

  // Extract appName or name
  const nameMatch = content.match(/(?:appName|name)\s*:\s*["']([^"']+)["']/);
  config.appName = nameMatch ? nameMatch[1] : "my-supa-app";

  // Extract displayName
  const displayMatch = content.match(/displayName\s*:\s*["']([^"']+)["']/);
  config.appDisplayName = displayMatch ? displayMatch[1] : config.appName;

  // Extract GitHub owner/repo if present
  const ownerMatch = content.match(/(?:githubOwner|owner)\s*:\s*["']([^"']+)["']/);
  config.githubOwner = ownerMatch ? ownerMatch[1] : null;

  const repoMatch = content.match(/(?:githubRepo|repo)\s*:\s*["']([^"']+)["']/);
  config.githubRepo = repoMatch ? repoMatch[1] : null;

  return config;
}

function applyTemplateVars(content, config) {
  let result = content;
  result = result.replace(/\{\{APP_NAME\}\}/g, config.appName);
  result = result.replace(/\{\{APP_DISPLAY_NAME\}\}/g, config.appDisplayName || config.appName);

  if (config.githubOwner) {
    result = result.replace(/OWNER/g, config.githubOwner);
  }
  if (config.githubRepo) {
    result = result.replace(/"REPO"/g, `"${config.githubRepo}"`);
  }

  return result;
}

function filesAreEqual(path, newContent) {
  if (!existsSync(path)) return false;
  const existing = readFileSync(path, "utf-8");
  return existing === newContent;
}

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function getAllFiles(dir, baseDir = dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push(relative(baseDir, fullPath));
    }
  }
  return files;
}

// --- Main sync logic ---

function sync(projectRoot, options = {}) {
  const { force = false, dryRun = false } = options;
  const config = loadSupaConfig(projectRoot);
  const claudeDir = join(projectRoot, ".claude");
  const commandsDir = join(claudeDir, "commands");

  const results = {
    created: [],
    updated: [],
    skipped: [],
    unchanged: [],
  };

  console.log(`\n  @supa-media/claude sync`);
  console.log(`  Project: ${config.appName}`);
  console.log(`  Target:  ${claudeDir}\n`);

  if (dryRun) {
    console.log("  (dry run - no files will be written)\n");
  }

  // --- 1. Sync CLAUDE.md to project root ---
  const claudeMdTemplate = readFileSync(join(TEMPLATES_DIR, "CLAUDE.md"), "utf-8");
  const claudeMdContent = applyTemplateVars(claudeMdTemplate, config);
  const claudeMdPath = join(projectRoot, "CLAUDE.md");

  if (!existsSync(claudeMdPath)) {
    if (!dryRun) writeFileSync(claudeMdPath, claudeMdContent);
    results.created.push("CLAUDE.md");
  } else if (force) {
    if (!filesAreEqual(claudeMdPath, claudeMdContent)) {
      if (!dryRun) writeFileSync(claudeMdPath, claudeMdContent);
      results.updated.push("CLAUDE.md");
    } else {
      results.unchanged.push("CLAUDE.md");
    }
  } else {
    results.skipped.push("CLAUDE.md (exists, use --force to overwrite)");
  }

  // --- 2. Sync settings.json ---
  ensureDir(claudeDir);
  const settingsTemplate = readFileSync(join(TEMPLATES_DIR, "settings.json"), "utf-8");
  const settingsPath = join(claudeDir, "settings.json");

  if (!existsSync(settingsPath)) {
    if (!dryRun) writeFileSync(settingsPath, settingsTemplate);
    results.created.push(".claude/settings.json");
  } else if (force) {
    if (!filesAreEqual(settingsPath, settingsTemplate)) {
      if (!dryRun) writeFileSync(settingsPath, settingsTemplate);
      results.updated.push(".claude/settings.json");
    } else {
      results.unchanged.push(".claude/settings.json");
    }
  } else {
    results.skipped.push(".claude/settings.json (exists)");
  }

  // --- 3. Sync hooks.json ---
  const hooksTemplate = readFileSync(join(TEMPLATES_DIR, "hooks.json"), "utf-8");
  const hooksContent = applyTemplateVars(hooksTemplate, config);
  const hooksPath = join(claudeDir, "hooks.json");

  if (!existsSync(hooksPath)) {
    if (!dryRun) writeFileSync(hooksPath, hooksContent);
    results.created.push(".claude/hooks.json");
  } else if (force) {
    if (!filesAreEqual(hooksPath, hooksContent)) {
      if (!dryRun) writeFileSync(hooksPath, hooksContent);
      results.updated.push(".claude/hooks.json");
    } else {
      results.unchanged.push(".claude/hooks.json");
    }
  } else {
    results.skipped.push(".claude/hooks.json (exists)");
  }

  // --- 4. Sync command templates ---
  ensureDir(commandsDir);
  const commandTemplatesDir = join(TEMPLATES_DIR, "commands");
  const commandFiles = getAllFiles(commandTemplatesDir);

  for (const relPath of commandFiles) {
    const templatePath = join(commandTemplatesDir, relPath);
    const templateContent = readFileSync(templatePath, "utf-8");
    const content = applyTemplateVars(templateContent, config);
    const destPath = join(commandsDir, relPath);

    ensureDir(dirname(destPath));

    if (!existsSync(destPath)) {
      if (!dryRun) writeFileSync(destPath, content);
      results.created.push(`.claude/commands/${relPath}`);
    } else if (force) {
      if (!filesAreEqual(destPath, content)) {
        if (!dryRun) writeFileSync(destPath, content);
        results.updated.push(`.claude/commands/${relPath}`);
      } else {
        results.unchanged.push(`.claude/commands/${relPath}`);
      }
    } else {
      // Check if the file content matches - if so, it's unchanged
      if (filesAreEqual(destPath, content)) {
        results.unchanged.push(`.claude/commands/${relPath}`);
      } else {
        results.skipped.push(`.claude/commands/${relPath} (exists, use --force to overwrite)`);
      }
    }
  }

  // --- Print results ---
  if (results.created.length > 0) {
    console.log("  Created:");
    for (const f of results.created) console.log(`    + ${f}`);
  }

  if (results.updated.length > 0) {
    console.log("  Updated:");
    for (const f of results.updated) console.log(`    ~ ${f}`);
  }

  if (results.skipped.length > 0) {
    console.log("  Skipped:");
    for (const f of results.skipped) console.log(`    - ${f}`);
  }

  if (results.unchanged.length > 0) {
    console.log("  Unchanged:");
    for (const f of results.unchanged) console.log(`    = ${f}`);
  }

  const totalChanges = results.created.length + results.updated.length;
  if (totalChanges === 0 && results.skipped.length === 0) {
    console.log("  Everything is up to date.\n");
  } else if (totalChanges > 0) {
    console.log(`\n  ${totalChanges} file(s) synced.\n`);
  } else {
    console.log(`\n  No changes made. Use --force to overwrite existing files.\n`);
  }

  return results;
}

// --- CLI ---

function main() {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith("--")) || "sync";
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");

  if (command === "help" || args.includes("--help") || args.includes("-h")) {
    console.log(`
  @supa-media/claude - Claude Code configuration for Supa apps

  Usage:
    npx @supa-media/claude sync              Sync templates into .claude/ and generate CLAUDE.md
    npx @supa-media/claude sync --force      Overwrite existing files
    npx @supa-media/claude sync --dry-run    Preview changes without writing files
    npx @supa-media/claude help              Show this help message

  Configuration:
    The sync command reads app-specific values from supa.config.ts (or .js/.mjs)
    in your project root. Supported fields:

      appName       - Used in CLAUDE.md template (e.g., project naming)
      displayName   - Human-readable app name
      githubOwner   - GitHub org/user for GraphQL queries in review-cycle
      githubRepo    - GitHub repo name for GraphQL queries in review-cycle

    If no config file is found, values are read from package.json.
`);
    process.exit(0);
  }

  if (command !== "sync") {
    console.error(`  Unknown command: ${command}\n  Run 'npx @supa-media/claude help' for usage.`);
    process.exit(1);
  }

  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    console.error("  Could not find project root (no package.json found).");
    process.exit(1);
  }

  sync(projectRoot, { force, dryRun });
}

main();
