"use strict";

/**
 * The rule engine: turns a scan + config (+ optional base comparison) into
 * a flat list of findings. Each finding is one reportable line; `report.js`
 * is the only place that knows how to print them.
 *
 * @typedef {Object} Finding
 * @property {"error"|"warning"|"info"} level
 * @property {string} path
 * @property {string} message
 * @property {string} [action] - the concrete next step, when there is one
 */

/** Findings from config-shape errors collected elsewhere (config.js). */
function configErrorFindings(errors) {
  return errors.map((message) => ({
    level: "error",
    path: "architecture.config.json",
    message,
  }));
}

/**
 * @param {Object} params
 * @param {Object} params.cfg - normalized config (see config.js)
 * @param {{warn: number, review: number, max: number}} params.thresholds - resolved
 * @param {Object<string, {lineCount: number, maxLineLength: number, generated: boolean}>} params.files
 * @param {null | {
 *   cfg: Object,
 *   thresholds: {warn: number, review: number, max: number},
 *   getBaseLineCount: (relPath: string) => number | null,
 *   allowGeneratedChange: boolean,
 * }} params.base
 * @returns {Finding[]}
 */
function evaluateRules({ cfg, thresholds, files, base }) {
  const findings = [];

  evaluateBaselineEntries({ cfg, thresholds, files, findings });
  evaluateMissingBaselines({ cfg, thresholds, files, findings });
  evaluateReviewedEntries({ cfg, thresholds, files, base, findings });
  evaluateInfoAndLongLines({ cfg, thresholds, files, findings });

  if (base) {
    evaluateBaseBaselineDiff({ cfg, base, findings });
    evaluateBaseThresholdDiff({ thresholds, base, findings });
    evaluateBaseGeneratedDiff({ cfg, base, findings });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Local (no-base) rules
// ---------------------------------------------------------------------------

/** Every existing `baseline` entry: allowance must stay >= current count. */
function evaluateBaselineEntries({ cfg, thresholds, files, findings }) {
  for (const [relPath, baselineCount] of Object.entries(cfg.baseline)) {
    const stats = files[relPath];
    if (!stats || stats.generated) continue; // missing/generated already handled elsewhere

    if (stats.lineCount <= thresholds.max) {
      findings.push({
        level: "error",
        path: relPath,
        message: `no longer exceeds the max threshold (${stats.lineCount} <= ${thresholds.max}); the baseline entry is stale`,
        action: "remove baseline entry",
      });
      continue;
    }

    if (baselineCount < stats.lineCount) {
      findings.push({
        level: "error",
        path: relPath,
        message: `grew past its baseline allowance (baseline ${baselineCount}, now ${stats.lineCount})`,
        action: `split this file, or raise the baseline to ${stats.lineCount} in a deliberate change`,
      });
    } else if (baselineCount > stats.lineCount) {
      findings.push({
        level: "warning",
        path: relPath,
        message: `shrank below its baseline allowance (baseline ${baselineCount}, now ${stats.lineCount})`,
        action: `lower baseline to ${stats.lineCount}`,
      });
    }
  }
}

/** Files over max with no baseline entry to justify it. */
function evaluateMissingBaselines({ cfg, thresholds, files, findings }) {
  for (const [relPath, stats] of Object.entries(files)) {
    if (stats.generated) continue;
    if (stats.lineCount <= thresholds.max) continue;
    if (Object.prototype.hasOwnProperty.call(cfg.baseline, relPath)) continue;

    findings.push({
      level: "error",
      path: relPath,
      message: `exceeds max threshold (${stats.lineCount} > ${thresholds.max}) with no baseline entry`,
      action: "split this file",
      count: stats.lineCount,
      threshold: thresholds.max,
    });
  }
}

/** Stale `reviewed` entries, and files needing one they don't have. */
function evaluateReviewedEntries({ cfg, thresholds, files, base, findings }) {
  for (const [relPath, reason] of Object.entries(cfg.reviewed)) {
    void reason;
    const stats = files[relPath];
    if (!stats || stats.generated) continue;
    if (stats.lineCount <= thresholds.review) {
      findings.push({
        level: "error",
        path: relPath,
        message: `has a reviewed entry but is now at or below the review threshold (${stats.lineCount} <= ${thresholds.review})`,
        action: "remove reviewed entry",
      });
    }
  }

  for (const [relPath, stats] of Object.entries(files)) {
    if (stats.generated) continue;
    if (stats.lineCount <= thresholds.review) continue;
    if (Object.prototype.hasOwnProperty.call(cfg.reviewed, relPath)) continue;

    if (!base) {
      findings.push({
        level: "warning",
        path: relPath,
        message: `is over the review threshold (${stats.lineCount} > ${thresholds.review}) with no reviewed entry`,
        action: "add a reviewed reason to architecture.config.json, or split this file",
        count: stats.lineCount,
        threshold: thresholds.review,
      });
      continue;
    }

    const baseCount = base.getBaseLineCount(relPath);
    const isNewOrGrew = baseCount === null || stats.lineCount > baseCount;
    findings.push({
      level: isNewOrGrew ? "error" : "warning",
      path: relPath,
      message: isNewOrGrew
        ? `is new or grew past the review threshold (${stats.lineCount} > ${thresholds.review}) with no reviewed entry`
        : `is over the review threshold (${stats.lineCount} > ${thresholds.review}) with no reviewed entry`,
      action: "add a reviewed reason to architecture.config.json, or split this file",
      count: stats.lineCount,
      threshold: thresholds.review,
    });
  }
}

/** Purely informational: over-warn files, and suspiciously long lines. */
function evaluateInfoAndLongLines({ cfg, thresholds, files, findings }) {
  for (const [relPath, stats] of Object.entries(files)) {
    if (stats.generated) continue;

    if (stats.lineCount > thresholds.warn && stats.lineCount <= thresholds.review) {
      findings.push({
        level: "info",
        path: relPath,
        message: `over the warn threshold (${stats.lineCount} > ${thresholds.warn})`,
        action: "keep an eye on this file before it crosses the review threshold",
        count: stats.lineCount,
        threshold: thresholds.warn,
      });
    }

    if (stats.maxLineLength > 1000) {
      findings.push({
        level: "warning",
        path: relPath,
        message: `contains a line over 1000 characters (${stats.maxLineLength}) — possible embedded or minified content`,
        action: "extract it to its own asset, or list this file in generated with a reason",
      });
    }
  }
  void cfg;
}

// ---------------------------------------------------------------------------
// --base rules
// ---------------------------------------------------------------------------

/** New or inflated baseline entries versus base — the ratchet only shrinks. */
function evaluateBaseBaselineDiff({ cfg, base, findings }) {
  for (const [relPath, count] of Object.entries(cfg.baseline)) {
    const baseCount = base.cfg.baseline[relPath];
    if (baseCount === undefined) {
      findings.push({
        level: "error",
        path: relPath,
        message: "new baseline entry not present at the base ref — baselines only shrink",
        action:
          "do not add new baseline exemptions in a PR (this also catches renaming a baselined file); split the file instead",
      });
    } else if (count > baseCount) {
      findings.push({
        level: "error",
        path: relPath,
        message: `baseline allowance raised from ${baseCount} to ${count} versus base`,
        action: `lower baseline back to ${baseCount} or below`,
      });
    }
  }
}

/** thresholds.* must never move in the more-permissive direction vs base. */
function evaluateBaseThresholdDiff({ thresholds, base, findings }) {
  for (const key of ["warn", "review", "max"]) {
    if (thresholds[key] > base.thresholds[key]) {
      findings.push({
        level: "error",
        path: "architecture.config.json",
        message: `thresholds.${key} raised from ${base.thresholds[key]} to ${thresholds[key]} versus base`,
        action: "revert the threshold change, or make it its own deliberate decision",
      });
    }
  }
}

/** A new `generated` exception is a policy change that needs the flag. */
function evaluateBaseGeneratedDiff({ cfg, base, findings }) {
  const basePaths = new Set(base.cfg.generated.map((g) => g.path));
  for (const entry of cfg.generated) {
    if (basePaths.has(entry.path)) continue;
    if (base.allowGeneratedChange) continue;

    findings.push({
      level: "error",
      path: entry.path,
      message: `POLICY CHANGE: new generated entry versus base ("${entry.reason}")`,
      action:
        "run locally with --allow-generated-change once you've deliberately reviewed why this file is generated (never pass that flag in CI)",
    });
  }
}

module.exports = { evaluateRules, configErrorFindings };
