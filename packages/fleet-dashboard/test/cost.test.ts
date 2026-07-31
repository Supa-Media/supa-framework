import assert from "node:assert/strict";
import { test } from "node:test";

import {
  costForWorkflow,
  formatUsd,
  parseCostReport,
  pickLatestReports,
  reportTotal,
} from "../src/lib/cost";

const REPORT = [
  "## Gardener activity — July 2026",
  "",
  "| Workflow | Runs | Tokens | Cost |",
  "| --- | ---: | ---: | ---: |",
  "| `gardener-triage` | 31 | 412,004 | $2.41 |",
  "| [gardener-dep-bump](https://github.com/x/y) | 4 | 88,120 | $0.55 |",
  "| **Total** | 35 | 500,124 | **$2.96** |",
  "",
  "_Costs are estimates._",
].join("\n");

test("parses a gh-aw cost table into per-workflow spend", () => {
  const report = parseCostReport(REPORT);

  assert.equal(report.byWorkflow.get("gardener-triage"), 2.41);
  // Markdown links and bold markers are stripped from the name cell.
  assert.equal(report.byWorkflow.get("gardener-dep-bump"), 0.55);
  // The total row feeds `totalUsd`, not the per-workflow map.
  assert.equal(report.byWorkflow.has("Total"), false);
  assert.equal(report.totalUsd, 2.96);
  assert.equal(reportTotal(report), 2.96);
});

test("the money column is found even when it isn't last, and commas survive", () => {
  const report = parseCostReport(
    ["| Workflow | Cost | Notes |", "| --- | --- | --- |", "| big-gardener | $1,204.50 | ok |"].join(
      "\n",
    ),
  );
  assert.equal(report.byWorkflow.get("big-gardener"), 1204.5);
});

test("a Budget column to the right of Cost is not reported as spend", () => {
  // The naive right-to-left scan read $50.00 here — a 25x overstatement of a
  // number whose entire job is to be trusted at a glance.
  const report = parseCostReport(
    [
      "| Workflow | Cost | Budget |",
      "| --- | ---: | ---: |",
      "| g-a | $2.00 | $50.00 |",
      "| g-b | $1.50 | $50.00 |",
    ].join("\n"),
  );

  assert.equal(report.byWorkflow.get("g-a"), 2);
  assert.equal(report.byWorkflow.get("g-b"), 1.5);
  assert.equal(reportTotal(report), 3.5);
});

test("header binding also handles Spend, and ignores lookalike money columns", () => {
  const report = parseCostReport(
    ["| Workflow | Remaining | Spend |", "| --- | --- | --- |", "| g-a | $48.00 | $2.00 |"].join(
      "\n",
    ),
  );
  assert.equal(report.byWorkflow.get("g-a"), 2);
});

test("subtotal rows are summaries, not workflows, and never double-count", () => {
  const report = parseCostReport(
    [
      "| Workflow | Cost |",
      "| --- | --- |",
      "| g-a | $1.00 |",
      "| Subtotal | $1.00 |",
      "| g-b | $2.00 |",
      "| Total | $3.00 |",
    ].join("\n"),
  );

  assert.equal(report.byWorkflow.has("Subtotal"), false);
  assert.equal(report.byWorkflow.has("Total"), false);
  assert.deepEqual([...report.byWorkflow.entries()], [["g-a", 1], ["g-b", 2]]);
  assert.equal(reportTotal(report), 3);
});

test("the newest report wins per repo, regardless of arrival order", () => {
  // The report is weekly, so a year of gardeners means ~52 candidates. Picking
  // the wrong one presents a stale week as current, with no staleness signal.
  const candidates = [
    { title: "[gardeners] weekly cost & activity report", updatedAt: "2026-07-06T00:00:00Z", repoKey: "o/a" },
    { title: "[gardeners] weekly cost & activity report", updatedAt: "2026-07-27T00:00:00Z", repoKey: "o/a" },
    { title: "[gardeners] weekly cost & activity report", updatedAt: "2026-07-13T00:00:00Z", repoKey: "o/a" },
    { title: "[gardeners] weekly cost & activity report", updatedAt: "2026-07-20T00:00:00Z", repoKey: "o/b" },
    { title: "gardeners: something else entirely", updatedAt: "2026-07-31T00:00:00Z", repoKey: "o/a" },
  ];

  const latest = pickLatestReports(candidates, "[gardeners] weekly cost & activity report");

  assert.equal(latest.size, 2);
  assert.equal(latest.get("o/a")?.updatedAt, "2026-07-27T00:00:00Z");
  assert.equal(latest.get("o/b")?.updatedAt, "2026-07-20T00:00:00Z");
});

test("a missing or moneyless report yields null, not zero", () => {
  const empty = parseCostReport("No gardener runs this week.");
  assert.equal(empty.byWorkflow.size, 0);
  assert.equal(reportTotal(empty), null);
  // "we don't know" must not render as "it was free".
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd(0), "$0.00");
});

test("lookup tolerates the several ways a report names a workflow", () => {
  const report = parseCostReport(REPORT);

  assert.equal(costForWorkflow(report, "gardener-triage"), 2.41);
  // Falls back to a normalized match when no candidate matches exactly.
  assert.equal(costForWorkflow(report, "Gardener: Triage", "gardener-triage.md"), 2.41);
  assert.equal(costForWorkflow(report, "gardener-unknown"), null);
});

test("reportTotal sums the rows when the report has no total line", () => {
  const report = parseCostReport(
    ["| Workflow | Cost |", "| --- | --- |", "| a | $1.00 |", "| b | $2.50 |"].join("\n"),
  );
  assert.equal(report.totalUsd, null);
  assert.equal(reportTotal(report), 3.5);
});
