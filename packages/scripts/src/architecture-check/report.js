"use strict";

/**
 * Everything about turning findings (and, for `--report`, raw scan stats)
 * into text on stdout — including GitHub Actions `::error`/`::warning`
 * annotations and `--json` output. No rule logic lives here.
 */

const inGithubActions = () => process.env.GITHUB_ACTIONS === "true";

/** Escapes the handful of characters GitHub Actions annotations care about. */
function escapeAnnotation(text) {
  return String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function printAnnotation(level, finding) {
  const cmd = level === "error" ? "error" : "warning";
  console.log(`::${cmd} file=${finding.path}::${escapeAnnotation(finding.message)}`);
}

/**
 * Prints findings as plain text (or JSON), one line per finding, plus a
 * summary. Returns true if any finding is an error (the caller's exit
 * code).
 */
function printFindings(findings, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify({ findings }, null, 2));
    return findings.some((f) => f.level === "error");
  }

  const byLevel = { error: [], warning: [], info: [] };
  for (const f of findings) byLevel[f.level].push(f);

  for (const level of ["error", "warning", "info"]) {
    for (const f of byLevel[level]) {
      const tag = level.toUpperCase().padEnd(7, " ");
      const threshold = f.threshold !== undefined ? ` (threshold ${f.threshold})` : "";
      const action = f.action ? ` — ${f.action}` : "";
      console.log(`${tag} ${f.path}: ${f.message}${threshold}${action}`);
      if (inGithubActions() && level !== "info") printAnnotation(level, f);
    }
  }

  console.log("");
  console.log(
    `${byLevel.error.length} error(s), ${byLevel.warning.length} warning(s), ${byLevel.info.length} info`
  );

  return byLevel.error.length > 0;
}

// ---------------------------------------------------------------------------
// --report
// ---------------------------------------------------------------------------

function isTestPath(relPath) {
  return (
    relPath.includes("/__tests__/") ||
    relPath.includes("/test/") ||
    relPath.includes(".test.") ||
    relPath.includes(".spec.")
  );
}

function isDocPath(relPath) {
  if (!/^docs\//.test(relPath)) return false;
  return /\.(md|mdx|html)$/.test(relPath);
}

function categorize(relPath) {
  if (isTestPath(relPath)) return "tests";
  if (isDocPath(relPath)) return "docs";
  return "source";
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

function statsFor(counts) {
  if (counts.length === 0) {
    return { count: 0, mean: 0, median: 0, p95: 0, max: 0 };
  }
  const sorted = [...counts].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    count: sorted.length,
    mean: Math.round((sum / sorted.length) * 10) / 10,
    median,
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Builds the `--report` payload: per-category stats over handwritten
 * (non-generated) files, plus the top 20 largest overall.
 */
function buildReport(files) {
  const byCategory = { tests: [], docs: [], source: [] };
  const entries = [];

  for (const [relPath, stats] of Object.entries(files)) {
    if (stats.generated) continue;
    const category = categorize(relPath);
    byCategory[category].push(stats.lineCount);
    entries.push({ path: relPath, lines: stats.lineCount, category });
  }

  entries.sort((a, b) => b.lines - a.lines);

  return {
    categories: {
      tests: statsFor(byCategory.tests),
      docs: statsFor(byCategory.docs),
      source: statsFor(byCategory.source),
    },
    top20: entries.slice(0, 20),
  };
}

function printReport(files, { json = false } = {}) {
  const report = buildReport(files);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Line count report (handwritten files only)");
  console.log("");
  for (const [category, stats] of Object.entries(report.categories)) {
    console.log(
      `${category.padEnd(8, " ")} count=${stats.count} mean=${stats.mean} median=${stats.median} p95=${stats.p95} max=${stats.max}`
    );
  }
  console.log("");
  console.log("Top 20 largest files:");
  for (const entry of report.top20) {
    console.log(`  ${String(entry.lines).padStart(6, " ")}  ${entry.path}`);
  }
}

module.exports = { printFindings, printReport, buildReport };
