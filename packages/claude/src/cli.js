#!/usr/bin/env node

/**
 * @supa-media/claude CLI — thin wrapper around the sync library.
 *
 * Usage:
 *   supa-claude sync              Sync templates into .claude/ and generate CLAUDE.md
 *   supa-claude sync --force      Overwrite existing files
 *   supa-claude sync --dry-run    Preview changes without writing files
 *   supa-claude help              Show this help message
 */

import { sync, findProjectRoot } from "./sync.js";

function main() {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith("--")) || "sync";
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");

  if (command === "help" || args.includes("--help") || args.includes("-h")) {
    console.log(`
  @supa-media/claude - Claude Code configuration for Supa apps

  Usage:
    supa-claude sync              Sync templates into .claude/ and generate CLAUDE.md
    supa-claude sync --force      Overwrite existing files
    supa-claude sync --dry-run    Preview changes without writing files
    supa-claude help              Show this help message

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
    console.error(`  Unknown command: ${command}\n  Run 'supa-claude help' for usage.`);
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
