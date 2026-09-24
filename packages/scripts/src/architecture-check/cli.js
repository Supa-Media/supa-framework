#!/usr/bin/env node
"use strict";

/**
 * supa-architecture-check
 *
 * A file-size / architecture guard: enforces line-count thresholds on
 * git-tracked source files, with an escape hatch (`generated`) for
 * machine-written files and a one-way ratchet (`baseline`) for legacy
 * debt that can only shrink. Full docs: packages/scripts/README.md.
 *
 * Usage:
 *   supa-architecture-check [--config PATH] [--base REF] [--report]
 *                            [--json] [--allow-generated-change] [--init]
 */

const path = require("path");
const fs = require("fs");

const git = require("./git");
const {
  DEFAULT_THRESHOLDS,
  emptyConfig,
  normalizeConfig,
  loadConfigFile,
  validateConfigShape,
  resolveThresholds,
  buildInitConfig,
  writeInitConfig,
} = require("./config");
const { scanRepo } = require("./scan");
const { evaluateRules, configErrorFindings } = require("./rules");
const { printFindings, printReport } = require("./report");
const { countLines } = require("./lines");

const CONFIG_BASENAME = "architecture.config.json";

function parseArgs(argv) {
  const opts = {
    config: null,
    base: null,
    report: false,
    json: false,
    allowGeneratedChange: false,
    init: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--config":
        opts.config = argv[++i];
        break;
      case "--base":
        opts.base = argv[++i];
        break;
      case "--report":
        opts.report = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--allow-generated-change":
        opts.allowGeneratedChange = true;
        break;
      case "--init":
        opts.init = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(2);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: supa-architecture-check [options]

Options:
  --config PATH             Path to architecture.config.json (default: ./architecture.config.json)
  --base REF                Compare against this git ref's config and line counts (for PRs)
  --report                  Print line-count statistics instead of (in addition to) rule checking
  --json                    Machine-readable output
  --allow-generated-change  Permit a new "generated" entry or "exclude" pattern vs --base (never pass this in CI)
  --init                    Write a starter architecture.config.json and exit
  -h, --help                Show this help message
`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const cwd = process.cwd();
  const configPath = opts.config ? path.resolve(opts.config) : path.join(cwd, CONFIG_BASENAME);

  let trackedFiles;
  try {
    trackedFiles = git.listTrackedFiles(cwd);
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(2);
  }
  const trackedSet = new Set(trackedFiles);

  if (opts.init) {
    runInit({ configPath, cwd, trackedFiles });
    return;
  }

  if (!fs.existsSync(configPath)) {
    console.error(
      `${configPath} not found. Run "supa-architecture-check --init" to create one, or pass --config.`
    );
    process.exit(2);
  }

  let cfg;
  try {
    cfg = normalizeConfig(loadConfigFile(configPath));
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(2);
  }

  const configErrors = validateConfigShape(cfg, trackedSet, path.relative(cwd, configPath) || CONFIG_BASENAME);
  const thresholds = resolveThresholds(cfg);

  const { files } = scanRepo(cwd, trackedFiles, cfg);

  let base = null;
  if (opts.base) {
    base = buildBaseContext({ cwd, ref: opts.base, configPath, allowGeneratedChange: opts.allowGeneratedChange });
  }

  const findings = [
    ...configErrorFindings(configErrors),
    ...evaluateRules({ cfg, thresholds, files, base }),
  ];

  // --report prints line-count statistics instead of the findings list.
  // The exit code still reflects pass/fail, so it's safe to use in CI
  // alongside a separate, non---report invocation.
  const hasError = findings.some((f) => f.level === "error");
  if (opts.report) {
    printReport(files, { json: opts.json });
  } else {
    printFindings(findings, { json: opts.json });
  }
  process.exit(hasError ? 1 : 0);
}

/** Loads the config (and its resolved thresholds) as it existed at `ref`. */
function buildBaseContext({ cwd, ref, configPath, allowGeneratedChange }) {
  const relConfigPath = path.relative(cwd, configPath) || CONFIG_BASENAME;

  let baseRaw = null;
  try {
    baseRaw = git.readJsonAtRef(cwd, ref, relConfigPath);
  } catch (err) {
    console.error(`--base ${ref}: could not read ${relConfigPath} at that ref: ${err.message}`);
    process.exit(2);
  }
  const baseCfg = baseRaw === null ? emptyConfig() : normalizeConfig(baseRaw);
  const baseThresholds = resolveThresholds(baseCfg);

  const lineCountCache = new Map();
  function getBaseLineCount(relPath) {
    if (lineCountCache.has(relPath)) return lineCountCache.get(relPath);
    const buf = git.readFileAtRef(cwd, ref, relPath);
    const result = buf === null ? null : countLines(buf).lineCount;
    lineCountCache.set(relPath, result);
    return result;
  }

  return {
    cfg: baseCfg,
    thresholds: baseThresholds,
    getBaseLineCount,
    allowGeneratedChange,
    bootstrap: baseRaw === null,
  };
}

function runInit({ configPath, cwd, trackedFiles }) {
  if (fs.existsSync(configPath)) {
    console.error(`${configPath} already exists — refusing to overwrite. Delete it first.`);
    process.exit(1);
  }

  const emptyCfgForScan = { exclude: [], generated: [] };
  const { files } = scanRepo(cwd, trackedFiles, emptyCfgForScan);

  const initConfig = buildInitConfig({ cwd, trackedFiles, fileStats: files });
  writeInitConfig(configPath, initConfig);

  console.log(`Wrote ${path.relative(cwd, configPath) || CONFIG_BASENAME}`);
  console.log(`  thresholds: ${JSON.stringify(DEFAULT_THRESHOLDS)}`);
  console.log(`  generated: ${initConfig.generated.length} entr${initConfig.generated.length === 1 ? "y" : "ies"}`);
  const baselineCount = Object.keys(initConfig.baseline).length;
  console.log(`  baseline: ${baselineCount} file(s) over max threshold`);
  if (baselineCount > 0) {
    for (const [p, count] of Object.entries(initConfig.baseline)) {
      console.log(`    ${count}  ${p}`);
    }
  }
}

module.exports = { main, parseArgs };

if (require.main === module) {
  main();
}
