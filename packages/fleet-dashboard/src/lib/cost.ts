/**
 * Parse the gh-aw `[gardeners] weekly cost & activity report` issue into
 * per-workflow month-to-date spend.
 *
 * The report is a markdown table posted by a maintenance workflow. Its exact
 * column set has changed between gh-aw versions and none of the fleet's repos
 * has one yet, so this parser is deliberately shape-tolerant rather than
 * schema-strict:
 *
 *   - any markdown table row is a candidate;
 *   - the workflow name is the first cell (backticks/links/emoji stripped);
 *   - the cost is the LAST cell in the row that looks like money, so an extra
 *     "runs" or "tokens" column in the middle doesn't break it;
 *   - a row whose name reads as a total feeds `totalUsd` instead of the map.
 *
 * When the report is missing or unparseable the UI shows "—" rather than $0.00,
 * because "we don't know" and "it was free" are different facts.
 */

export interface CostReport {
  /** Workflow name (as it appears in the report) → USD. */
  byWorkflow: Map<string, number>;
  /** The report's own total row, when it has one. */
  totalUsd: number | null;
}

const MONEY = /\$\s*(-?[\d,]+(?:\.\d+)?)/g;
const TOTAL_ROW = /^(?:\*\*)?\s*(?:grand\s+)?total\b/i;

/** `` `gardener-triage` `` / `[gardener-triage](url)` / `**x**` → `gardener-triage`. */
function cleanName(cell: string): string {
  return cell
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links/images
    .replace(/[`*_]/g, "")
    .trim();
}

function parseMoney(cell: string): number | null {
  MONEY.lastIndex = 0;
  let last: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = MONEY.exec(cell)) !== null) {
    const value = Number((match[1] as string).replace(/,/g, ""));
    if (Number.isFinite(value)) last = value;
  }
  return last;
}

export function parseCostReport(issueBody: string): CostReport {
  const byWorkflow = new Map<string, number>();
  let totalUsd: number | null = null;

  for (const rawLine of issueBody.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;

    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;

    // Separator row (`|---|---|`) and header rows carry no money.
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;

    // Scan right-to-left so a trailing cost column wins over a middle one.
    let cost: number | null = null;
    for (let i = cells.length - 1; i >= 1; i -= 1) {
      cost = parseMoney(cells[i] as string);
      if (cost !== null) break;
    }
    if (cost === null) continue;

    const name = cleanName(cells[0] as string);
    if (name === "") continue;

    if (TOTAL_ROW.test(name)) {
      totalUsd = cost;
      continue;
    }
    byWorkflow.set(name, cost);
  }

  return { byWorkflow, totalUsd };
}

/**
 * Look a gardener up in a cost report. Reports name workflows inconsistently
 * (`gardener-triage`, `gardener-triage.md`, `Gardener: Triage`), so match on a
 * normalized form before giving up.
 */
export function costForWorkflow(report: CostReport, ...candidates: string[]): number | null {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

  for (const candidate of candidates) {
    const direct = report.byWorkflow.get(candidate);
    if (direct !== undefined) return direct;
  }

  const wanted = new Set(candidates.map(normalize).filter((value) => value !== ""));
  if (wanted.size === 0) return null;

  for (const [name, cost] of report.byWorkflow) {
    if (wanted.has(normalize(name))) return cost;
  }
  return null;
}

/** Sum every per-workflow figure, preferring the report's own total row. */
export function reportTotal(report: CostReport): number | null {
  if (report.totalUsd !== null) return report.totalUsd;
  if (report.byWorkflow.size === 0) return null;
  let sum = 0;
  for (const cost of report.byWorkflow.values()) sum += cost;
  return sum;
}

export function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toFixed(2)}`;
}
