#!/usr/bin/env node

/**
 * @supa-media/dev — Development orchestrator
 *
 * Runs Convex dev + Expo together with labeled, colored output.
 *
 * Usage:
 *   require('@supa-media/dev').run()
 *
 * CLI flags:
 *   --mobile   Run only Expo (assumes Convex is running separately)
 *   --convex   Run only Convex dev
 *   --web      Run only Expo web
 *   --ios      Run Expo with --ios
 *   --android  Run Expo with --android
 *   (none)     Run Convex + Expo web together
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from cwd until we find pnpm-workspace.yaml or package.json with
 * "workspaces". Returns the absolute path to the monorepo root.
 */
function findWorkspaceRoot(from) {
  let dir = from || process.cwd();
  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(dir, "pnpm-lock.yaml"))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  // Fallback: return original directory
  return from || process.cwd();
}

/**
 * Read CONVEX_URL (or EXPO_PUBLIC_CONVEX_URL) from .env.local.
 * Falls back to deriving from CONVEX_DEPLOYMENT.
 */
function getConvexUrl(root) {
  const envLocalPath = path.join(root, ".env.local");

  if (!fs.existsSync(envLocalPath)) {
    return null;
  }

  const content = fs.readFileSync(envLocalPath, "utf-8");
  const lines = content.split("\n");

  // Check for explicit EXPO_PUBLIC_CONVEX_URL first
  for (const line of lines) {
    const match = line.match(/^EXPO_PUBLIC_CONVEX_URL\s*=\s*(.+)/);
    if (match) {
      return match[1].replace(/['"]/g, "").trim();
    }
  }

  // Derive from CONVEX_DEPLOYMENT
  for (const line of lines) {
    const match = line.match(/^CONVEX_DEPLOYMENT\s*=\s*(.+)/);
    if (match) {
      const deployment = match[1].replace(/['"]/g, "").trim();
      const slug = deployment.includes(":") ? deployment.split(":")[1] : deployment;
      return `https://${slug}.convex.cloud`;
    }
  }

  return null;
}

/**
 * Check if node_modules is fresh by comparing lockfile mtime+size.
 * If the lockfile changed since last install, returns true.
 */
function needsInstall(root) {
  const lockfilePath = path.join(root, "pnpm-lock.yaml");
  const hashMarkerPath = path.join(root, "node_modules", ".pnpm-lock-hash");

  if (!fs.existsSync(path.join(root, "node_modules"))) {
    return true;
  }

  if (!fs.existsSync(lockfilePath)) {
    return false;
  }

  const stats = fs.statSync(lockfilePath);
  const currentHash = `${stats.mtimeMs}-${stats.size}`;

  if (!fs.existsSync(hashMarkerPath)) {
    return true;
  }

  const storedHash = fs.readFileSync(hashMarkerPath, "utf-8").trim();
  return currentHash !== storedHash;
}

/**
 * Update the stored lockfile hash after a successful install.
 */
function updateLockfileHash(root) {
  const lockfilePath = path.join(root, "pnpm-lock.yaml");
  const hashMarkerPath = path.join(root, "node_modules", ".pnpm-lock-hash");

  if (!fs.existsSync(lockfilePath)) {
    return;
  }

  const stats = fs.statSync(lockfilePath);
  const currentHash = `${stats.mtimeMs}-${stats.size}`;
  fs.writeFileSync(hashMarkerPath, currentHash);
}

/**
 * Run pnpm install if the lockfile has changed since last install.
 */
function ensureDependencies(root) {
  if (!needsInstall(root)) {
    return;
  }

  console.log(chalk.yellow("Lockfile changed — installing dependencies..."));
  try {
    execSync("pnpm install", { cwd: root, stdio: "inherit" });
    updateLockfileHash(root);
    console.log(chalk.green("Dependencies installed\n"));
  } catch (e) {
    console.error(chalk.red("Failed to install dependencies"));
    process.exit(1);
  }
}

/**
 * Kill any process listening on the given port.
 */
function killProcessOnPort(port, label) {
  try {
    const result = execSync(`lsof -Pi :${port} -sTCP:LISTEN -t 2>/dev/null`, {
      encoding: "utf-8",
    });
    if (!result.trim()) return;

    const pids = result.trim().split("\n").filter(Boolean);
    const portLabel = label ? ` (${label})` : "";
    console.log(
      chalk.yellow(
        `Killing ${pids.length} process(es) on port ${port}${portLabel}...`
      )
    );

    for (const pid of pids) {
      try {
        execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: "ignore" });
      } catch (e) {
        // Process may have already exited
      }
    }

    // Brief pause to let the OS release the port
    execSync("sleep 0.5", { stdio: "ignore" });
    console.log(chalk.green(`Port ${port} is now free`));
  } catch (e) {
    // No process on port — nothing to do
  }
}

// ---------------------------------------------------------------------------
// Process spawning with labeled output
// ---------------------------------------------------------------------------

const LABEL_COLORS = {
  convex: chalk.magenta,
  expo: chalk.green,
  mobile: chalk.green,
};

/**
 * Spawn a child process with colored, labeled output.
 */
function spawnLabeled(command, args, cwd, label, env) {
  const colorFn = LABEL_COLORS[label] || chalk.cyan;
  const prefix = colorFn(`[${label}]`);

  const proc = spawn(command, args, {
    cwd,
    stdio: "pipe",
    shell: true,
    env: { ...env, FORCE_COLOR: "1" },
  });

  function printLines(stream, writer) {
    stream.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          writer(`${prefix} ${line}`);
        }
      }
    });
  }

  printLines(proc.stdout, console.log);
  printLines(proc.stderr, console.error);

  proc.on("close", (code) => {
    if (code !== 0) {
      console.log(`${prefix} exited with code ${code}`);
    }
  });

  return proc;
}

// ---------------------------------------------------------------------------
// Config loading (sync, for a CJS CLI tool)
// ---------------------------------------------------------------------------

/**
 * Attempt to load supa.config from the project root.
 * Returns a plain object or null if not found.
 */
function loadConfigSync(root) {
  // Try .js first (CJS-friendly), then .ts via require
  for (const ext of [".js", ".ts"]) {
    const configPath = path.join(root, `supa.config${ext}`);
    if (fs.existsSync(configPath)) {
      try {
        // For .ts files, try tsx/ts-node register if available
        if (ext === ".ts") {
          try {
            require("tsx/cjs");
          } catch (e) {
            try {
              require("ts-node/register/transpile-only");
            } catch (e2) {
              // Fall through — require may still work if project has its own loader
            }
          }
        }
        const mod = require(configPath);
        return mod.default || mod;
      } catch (e) {
        console.error(
          chalk.yellow(`Warning: Found ${configPath} but failed to load it: ${e.message}`)
        );
        return null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseFlags() {
  const args = process.argv.slice(2);
  return {
    mobile: args.includes("--mobile"),
    convex: args.includes("--convex"),
    web: args.includes("--web"),
    ios: args.includes("--ios"),
    android: args.includes("--android"),
  };
}

function run() {
  const flags = parseFlags();
  const hasFlag = flags.mobile || flags.convex || flags.web || flags.ios || flags.android;

  const root = findWorkspaceRoot(process.cwd());
  const config = loadConfigSync(root);
  const env = { ...process.env };

  // Read config values with sensible defaults
  const metroPort = (config && config.dev && config.dev.metroPort) || 8081;
  const functionsDir = (config && config.convex && config.convex.functionsDir) || null;

  // --- Ensure dependencies are fresh ---
  ensureDependencies(root);

  // --- Resolve Convex URL ---
  if (!env.EXPO_PUBLIC_CONVEX_URL) {
    const convexUrl = getConvexUrl(root);
    if (convexUrl) {
      env.EXPO_PUBLIC_CONVEX_URL = convexUrl;
    }
  }

  // --- Determine what to run ---
  const processes = [];

  function cleanup() {
    console.log(chalk.dim("\nShutting down..."));
    for (const proc of processes) {
      try {
        proc.kill("SIGTERM");
      } catch (e) {
        // already dead
      }
    }
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // -- Convex --
  const shouldRunConvex = flags.convex || !hasFlag;

  if (shouldRunConvex) {
    const convexArgs = ["convex", "dev"];
    if (functionsDir) {
      convexArgs.push("--functions", functionsDir);
    }
    console.log(chalk.magenta("Starting Convex dev server..."));
    const proc = spawnLabeled("npx", convexArgs, root, "convex", env);
    processes.push(proc);
  }

  // -- Expo --
  const shouldRunExpo = flags.mobile || flags.web || flags.ios || flags.android || !hasFlag;

  if (shouldRunExpo && !flags.convex) {
    // Kill any existing process on the Metro port
    killProcessOnPort(metroPort, "Metro");

    // Determine Expo args
    const expoArgs = ["expo", "start", "--port", String(metroPort)];

    if (flags.ios) {
      expoArgs.push("--ios");
    } else if (flags.android) {
      expoArgs.push("--android");
    } else if (flags.web || !hasFlag) {
      // Default to web when running both, or when --web is explicit
      expoArgs.push("--web");
    }
    // --mobile: no platform flag, Expo picks default

    // Try to find the mobile app directory
    const mobileCandidates = [
      path.join(root, "apps", "mobile"),
      path.join(root, "apps", "expo"),
      root, // single-app repo
    ];
    let mobileDir = root;
    for (const candidate of mobileCandidates) {
      if (
        fs.existsSync(candidate) &&
        (fs.existsSync(path.join(candidate, "app.json")) ||
          fs.existsSync(path.join(candidate, "app.config.js")) ||
          fs.existsSync(path.join(candidate, "app.config.ts")))
      ) {
        mobileDir = candidate;
        break;
      }
    }

    if (env.EXPO_PUBLIC_CONVEX_URL) {
      console.log(chalk.dim(`Convex URL: ${env.EXPO_PUBLIC_CONVEX_URL}`));
    } else if (!shouldRunConvex) {
      console.error(
        chalk.red(
          "No Convex URL found. Create a .env.local with EXPO_PUBLIC_CONVEX_URL " +
            "or CONVEX_DEPLOYMENT, or run Convex dev first."
        )
      );
      process.exit(1);
    }

    const expoLabel = flags.mobile ? "mobile" : "expo";
    console.log(chalk.green(`Starting Expo on port ${metroPort}...`));
    const proc = spawnLabeled("npx", expoArgs, mobileDir, expoLabel, env);
    processes.push(proc);
  }

  if (processes.length === 0) {
    console.error(chalk.red("Nothing to run. Use --convex, --mobile, --web, --ios, or --android."));
    process.exit(1);
  }

  // If any child exits with an error, log it but keep the others running
  for (const proc of processes) {
    proc.on("close", (code) => {
      if (code !== 0 && code !== null) {
        // If one process dies, kill the rest
        console.error(chalk.red(`\nA process exited with code ${code}. Shutting down.`));
        cleanup();
      }
    });
  }
}

// Support both `require('@supa-media/dev').run()` and direct CLI execution
module.exports = { run };
module.exports.run = run;
module.exports.findWorkspaceRoot = findWorkspaceRoot;
module.exports.getConvexUrl = getConvexUrl;
module.exports.ensureDependencies = ensureDependencies;
module.exports.killProcessOnPort = killProcessOnPort;

if (require.main === module) {
  run();
}
