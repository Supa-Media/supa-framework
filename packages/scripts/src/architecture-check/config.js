"use strict";

/**
 * `architecture.config.json` loading, validation and `--init` generation.
 *
 * The config's shape is documented in packages/scripts/README.md — keep
 * that doc in sync with anything added here.
 */

const fs = require("fs");

const DEFAULT_THRESHOLDS = { warn: 500, review: 700, max: 1000 };
const LOCKFILE_CANDIDATES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"];

/** An empty-but-well-formed config, used when a ref has no config file. */
function emptyConfig() {
  return { thresholds: {}, exclude: [], generated: [], reviewed: {}, baseline: {} };
}

/**
 * Normalizes a parsed config object, filling in defaults for absent
 * top-level keys without inventing values callers must remember to check.
 * Does not validate — that's `validateConfig`.
 */
function normalizeConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    thresholds: cfg.thresholds && typeof cfg.thresholds === "object" ? cfg.thresholds : {},
    exclude: Array.isArray(cfg.exclude) ? cfg.exclude : [],
    generated: Array.isArray(cfg.generated) ? cfg.generated : [],
    reviewed: cfg.reviewed && typeof cfg.reviewed === "object" ? cfg.reviewed : {},
    baseline: cfg.baseline && typeof cfg.baseline === "object" ? cfg.baseline : {},
  };
}

/** Reads and JSON-parses the config file at `configPath`, or throws. */
function loadConfigFile(configPath) {
  const text = fs.readFileSync(configPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${configPath} is not valid JSON: ${err.message}`);
  }
  return parsed;
}

/**
 * Validates a normalized config against the set of tracked files.
 * Returns an array of error strings (empty means the config is well
 * formed — this does not check size-threshold rules, only config shape).
 */
function validateConfigShape(cfg, trackedFilesSet, configLabel) {
  const errors = [];
  const label = configLabel || "architecture.config.json";

  // --- thresholds -----------------------------------------------------
  const t = cfg.thresholds;
  const hasWarn = t.warn !== undefined;
  const hasReview = t.review !== undefined;
  const hasMax = t.max !== undefined;
  for (const key of ["warn", "review", "max"]) {
    if (t[key] !== undefined && (!Number.isInteger(t[key]) || t[key] <= 0)) {
      errors.push(`${label}: thresholds.${key} must be a positive integer`);
    }
  }
  if (hasWarn && hasReview && t.warn >= t.review) {
    errors.push(`${label}: thresholds.warn must be less than thresholds.review`);
  }
  if (hasReview && hasMax && t.review >= t.max) {
    errors.push(`${label}: thresholds.review must be less than thresholds.max`);
  }
  if (hasWarn && hasMax && !hasReview && t.warn >= t.max) {
    errors.push(`${label}: thresholds.warn must be less than thresholds.max`);
  }

  // --- exclude ----------------------------------------------------------
  for (const pattern of cfg.exclude) {
    if (typeof pattern !== "string" || pattern.length === 0) {
      errors.push(`${label}: exclude entries must be non-empty strings`);
    }
  }

  // --- generated ----------------------------------------------------------
  const seenGenerated = new Set();
  for (const entry of cfg.generated) {
    if (!entry || typeof entry !== "object") {
      errors.push(`${label}: generated entries must be objects with path/reason/command`);
      continue;
    }
    const { path: entryPath, reason, command } = entry;
    if (typeof entryPath !== "string" || entryPath.length === 0) {
      errors.push(`${label}: generated entry missing a non-empty "path"`);
      continue;
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      errors.push(`${label}: generated["${entryPath}"] is missing a non-empty "reason"`);
    }
    if (typeof command !== "string" || command.trim().length === 0) {
      errors.push(`${label}: generated["${entryPath}"] is missing a non-empty "command"`);
    }
    if (seenGenerated.has(entryPath)) {
      errors.push(`${label}: generated["${entryPath}"] is listed more than once`);
    }
    seenGenerated.add(entryPath);
    if (trackedFilesSet && !trackedFilesSet.has(entryPath)) {
      errors.push(`${label}: generated["${entryPath}"] does not exist (not a tracked file)`);
    }
  }

  // --- reviewed ----------------------------------------------------------
  for (const [entryPath, reason] of Object.entries(cfg.reviewed)) {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      errors.push(`${label}: reviewed["${entryPath}"] must have a non-empty reason`);
    }
    if (trackedFilesSet && !trackedFilesSet.has(entryPath)) {
      errors.push(`${label}: reviewed["${entryPath}"] does not exist (not a tracked file)`);
    }
  }

  // --- baseline ----------------------------------------------------------
  for (const [entryPath, count] of Object.entries(cfg.baseline)) {
    if (!Number.isInteger(count) || count <= 0) {
      errors.push(`${label}: baseline["${entryPath}"] must be a positive integer line count`);
    }
    if (trackedFilesSet && !trackedFilesSet.has(entryPath)) {
      errors.push(`${label}: baseline["${entryPath}"] does not exist (not a tracked file)`);
    }
  }

  return errors;
}

/** Merges configured thresholds over the defaults. */
function resolveThresholds(cfg) {
  return { ...DEFAULT_THRESHOLDS, ...cfg.thresholds };
}

/**
 * Builds a fresh config for `--init`: default thresholds, any present
 * lockfile marked generated, and a baseline of every currently
 * over-`max` tracked file (for adopting the tool in an existing repo).
 */
function buildInitConfig({ cwd, trackedFiles, fileStats }) {
  const generated = [];
  for (const lockfile of LOCKFILE_CANDIDATES) {
    if (trackedFiles.includes(lockfile)) {
      generated.push({
        path: lockfile,
        reason: "Package manager lockfile — machine-generated, not hand-authored.",
        command: lockfile === "pnpm-lock.yaml" ? "pnpm install" : "npm install / yarn install",
      });
    }
  }

  const baseline = {};
  for (const [relPath, stats] of Object.entries(fileStats)) {
    if (generated.some((g) => g.path === relPath)) continue;
    if (stats.lineCount > DEFAULT_THRESHOLDS.max) {
      baseline[relPath] = stats.lineCount;
    }
  }

  return {
    thresholds: DEFAULT_THRESHOLDS,
    exclude: [],
    generated,
    reviewed: {},
    baseline,
  };
}

function writeInitConfig(configPath, config) {
  if (fs.existsSync(configPath)) {
    throw new Error(`${configPath} already exists — refusing to overwrite. Delete it first.`);
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

module.exports = {
  DEFAULT_THRESHOLDS,
  emptyConfig,
  normalizeConfig,
  loadConfigFile,
  validateConfigShape,
  resolveThresholds,
  buildInitConfig,
  writeInitConfig,
};
