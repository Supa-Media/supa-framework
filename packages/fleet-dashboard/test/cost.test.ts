import assert from "node:assert/strict";
import { test } from "node:test";

import { costForWorkflow, formatUsd, parseCostReport, reportTotal } from "../src/lib/cost";

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
