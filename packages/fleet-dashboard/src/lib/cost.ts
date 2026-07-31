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
/** `Total`, `Grand total`, `Subtotal`, `Sub-total` — never a workflow name. */
const TOTAL_ROW = /^(?:\*\*)?\s*(?:grand[\s-]*|sub[\s-]*)?totals?\b/i;
/** Header cells naming the column that holds actual spend. */
const COST_HEADER = /\b(cost|spend|spent|charged?)\b/i;
/** Header cells that hold money but are NOT spend — binding to these overstates. */
const NOT_COST_HEADER = /\b(budget|limit|cap|remaining|allowance|quota|forecast|projected)\b/i;

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

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

/**
 * Index of the column to read spend from, given a header row.
 *
 * Preferring a header match over position is what stops a `Budget` column to
 * the right of `Cost` being reported as the spend — a 25x overstatement in the
 * reviewer's probe, and exactly the kind of confident-but-wrong number this
 * dashboard must not show.
 */
function costColumnFromHeader(cells: string[]): number | null {
  for (let i = 1; i < cells.length; i += 1) {
    const header = cleanName(cells[i] as string);
    if (COST_HEADER.test(header) && !NOT_COST_HEADER.test(header)) return i;
  }
  return null;
}

export function parseCostReport(issueBody: string): CostReport {
  const byWorkflow = new Map<string, number>();
  let totalUsd: number | null = null;
  let costColumn: number | null = null;
  let sawSeparator = false;

  for (const rawLine of issueBody.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;

    const cells = splitRow(line);
    if (cells.length < 2) continue;

    if (isSeparatorRow(cells)) {
      sawSeparator = true;
      continue;
    }

    // The row above the separator is the header. Bind the cost column from it
    // once; a table with no header falls back to the positional scan below.
    if (!sawSeparator) {
      const bound = costColumnFromHeader(cells);
      if (bound !== null) costColumn = bound;
      continue;
    }

    let cost: number | null = null;
    if (costColumn !== null && costColumn < cells.length) {
      cost = parseMoney(cells[costColumn] as string);
    } else {
      // No usable header: scan right-to-left so a trailing cost column wins
      // over a middle one. Documented as the weaker path.
      for (let i = cells.length - 1; i >= 1; i -= 1) {
        cost = parseMoney(cells[i] as string);
        if (cost !== null) break;
      }
    }
    if (cost === null) continue;

    const name = cleanName(cells[0] as string);
    if (name === "") continue;

    // Total AND subtotal rows are summaries, never workflows — letting a
    // `Subtotal` row into the map would also double-count it in `reportTotal`.
    if (TOTAL_ROW.test(name)) {
      if (!/^(?:\*\*)?\s*sub/i.test(name)) totalUsd = cost;
      continue;
    }
    byWorkflow.set(name, cost);
  }

  return { byWorkflow, totalUsd };
}

/**
 * Pick the newest cost report per repo from a set of candidates.
 *
 * The report is *weekly*, so a repo running gardeners for a year accumulates
 * ~52 of them. Without an explicit newest-wins comparison the dashboard would
 * present an arbitrary past week as current — a staleness bug that only appears
 * once two reports exist, which is exactly when nobody is looking for it.
 */
export function pickLatestReports<T extends { title: string; updatedAt: string; repoKey: string }>(
  candidates: readonly T[],
  titleNeedle: string,
): Map<string, T> {
  const needle = titleNeedle.toLowerCase();
  const latest = new Map<string, T>();

  for (const candidate of candidates) {
    if (!candidate.title.toLowerCase().includes(needle)) continue;
    const incumbent = latest.get(candidate.repoKey);
    if (incumbent === undefined || candidate.updatedAt > incumbent.updatedAt) {
      latest.set(candidate.repoKey, candidate);
    }
  }

  return latest;
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
