/**
 * Cron parsing for the GARDENERS table: a 5-field GitHub Actions `schedule`
 * expression in, a human sentence and the next fire time out.
 *
 * Scope is deliberately the subset GitHub Actions actually accepts and that
 * gh-aw workflows actually use: `*`, fixed numbers, `a-b` ranges, `a,b` lists,
 * and `*` / range with a `/step`. No `@daily` macros (Actions rejects them), no
 * `L`/`W`/`#` (Quartz-only). Anything unparseable degrades to the raw
 * expression rather than throwing — a gardener with a weird cron should still
 * show its last run.
 *
 * All times are UTC because that is what GitHub Actions schedules in, and the
 * rendered strings say so.
 */

const DAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
] as const;

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** True when the field was a bare `*` — needed to phrase the sentence. */
  wildcard: {
    minute: boolean;
    hour: boolean;
    dayOfMonth: boolean;
    month: boolean;
    dayOfWeek: boolean;
  };
}

/** Expand one cron field into the sorted list of values it matches. */
function expandField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    if (rangePart === undefined || rangePart === "") return null;

    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step < 1) return null;
    }

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      start = Number(a);
      end = Number(b);
    } else {
      start = Number(rangePart);
      end = stepPart === undefined ? start : max;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < min || end > max || start > end) return null;

    for (let value = start; value <= end; value += step) values.add(value);
  }

  if (values.size === 0) return null;
  return [...values].sort((a, b) => a - b);
}

export function parseCron(expression: string): CronFields | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minutes = expandField(minute, 0, 59);
  const hours = expandField(hour, 0, 23);
  const daysOfMonth = expandField(dayOfMonth, 1, 31);
  const months = expandField(month, 1, 12);
  // Cron allows 7 for Sunday; normalize it to 0.
  const rawDaysOfWeek = expandField(dayOfWeek, 0, 7);

  if (!minutes || !hours || !daysOfMonth || !months || !rawDaysOfWeek) return null;

  const daysOfWeek = [...new Set(rawDaysOfWeek.map((d) => d % 7))].sort((a, b) => a - b);

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    wildcard: {
      minute: minute === "*",
      hour: hour === "*",
      dayOfMonth: dayOfMonth === "*",
      month: month === "*",
      dayOfWeek: dayOfWeek === "*",
    },
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `[0]` + `[9]` → "09:00"; multiple hours → "09:00, 21:00". */
function timesOfDay(fields: CronFields): string {
  const times: string[] = [];
  for (const hour of fields.hours) {
    for (const minute of fields.minutes) times.push(`${pad(hour)}:${pad(minute)}`);
  }
  return times.join(", ");
}

// True when the values form an even step starting at `min` and covering the
// whole range — i.e. the field was written as a wildcard with a step.
function evenStep(values: number[], min: number, max: number): number | null {
  if (values.length < 2) return null;
  const step = (values[1] as number) - (values[0] as number);
  if (values[0] !== min) return null;
  for (let i = 1; i < values.length; i += 1) {
    if ((values[i] as number) - (values[i - 1] as number) !== step) return null;
  }
  // The last value must be the final step that still fits in the range.
  if ((values[values.length - 1] as number) + step <= max) return null;
  return step;
}

function listDays(days: number[]): string {
  if (days.length === 7) return "every day";
  if (days.length === 5 && days.join() === "1,2,3,4,5") return "weekdays";
  if (days.length === 2 && days.join() === "0,6") return "weekends";
  return days.map((day) => DAY_NAMES[day] ?? `day ${day}`).join(", ");
}

/**
 * Render a cron expression as a short English phrase, e.g.
 * "Mondays at 09:00 UTC", "every 6 hours", "daily at 03:30 UTC".
 * Returns the raw expression when it can't be parsed.
 */
export function describeCron(expression: string): string {
  const fields = parseCron(expression);
  if (!fields) return expression.trim();

  const { wildcard } = fields;

  // Sub-hourly: `*/15 * * * *`
  if (!wildcard.minute && wildcard.hour && wildcard.dayOfMonth && wildcard.dayOfWeek) {
    const step = evenStep(fields.minutes, 0, 59);
    if (step !== null) return step === 1 ? "every minute" : `every ${step} minutes`;
  }
  if (wildcard.minute) {
    // A bare `*` minute means 60 runs an hour — call it out plainly.
    return `every minute${wildcard.hour ? "" : ` during ${timesOfDay(fields)} UTC`}`;
  }

  const at = `at ${timesOfDay(fields)} UTC`;

  // Hourly steps: `0 */6 * * *`, and plain hourly `0 * * * *`.
  if (wildcard.dayOfMonth && wildcard.dayOfWeek) {
    const step = evenStep(fields.hours, 0, 23);
    if (step !== null && fields.minutes.length === 1) {
      const minute = fields.minutes[0] as number;
      const suffix = minute === 0 ? "" : ` at :${pad(minute)}`;
      return step === 1 ? `hourly${suffix}` : `every ${step} hours${suffix}`;
    }
  }

  // Day-of-week schedules: `0 9 * * 1`
  if (!wildcard.dayOfWeek) {
    return `${listDays(fields.daysOfWeek)} ${at}`;
  }

  // Day-of-month schedules: `0 9 1 * *`
  if (!wildcard.dayOfMonth) {
    const days = fields.daysOfMonth.join(", ");
    const scope = wildcard.month ? "monthly" : "yearly";
    return `${scope} on day ${days} ${at}`;
  }

  return `daily ${at}`;
}

const MINUTE_MS = 60_000;

/**
 * Next UTC fire time strictly after `from`, or `null` if the expression is
 * unparseable or nothing matches within four years (e.g. `0 0 30 2 *`).
 *
 * Walks candidate days and only scans minutes on a matching day, so the worst
 * case is ~1,500 day checks rather than two million minute checks.
 */
export function nextRun(expression: string, from: Date = new Date()): Date | null {
  const fields = parseCron(expression);
  if (!fields) return null;

  const start = new Date(Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );

  const monthSet = new Set(fields.months);
  const domSet = new Set(fields.daysOfMonth);
  const dowSet = new Set(fields.daysOfWeek);

  for (let day = 0; day < 366 * 4; day += 1) {
    const month = cursor.getUTCMonth() + 1;
    const dayOfMonth = cursor.getUTCDate();
    const dayOfWeek = cursor.getUTCDay();

    // Vixie-cron rule: when BOTH day fields are restricted, either may match.
    const dayMatches = fields.wildcard.dayOfMonth
      ? dowSet.has(dayOfWeek)
      : fields.wildcard.dayOfWeek
        ? domSet.has(dayOfMonth)
        : domSet.has(dayOfMonth) || dowSet.has(dayOfWeek);

    if (monthSet.has(month) && dayMatches) {
      for (const hour of fields.hours) {
        for (const minute of fields.minutes) {
          const candidate = new Date(
            Date.UTC(
              cursor.getUTCFullYear(),
              cursor.getUTCMonth(),
              cursor.getUTCDate(),
              hour,
              minute,
            ),
          );
          if (candidate.getTime() >= start.getTime()) return candidate;
        }
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return null;
}

/**
 * Pull the first `cron:` value out of a workflow YAML file.
 *
 * A regex rather than a YAML parser on purpose: a compiled gh-aw `.lock.yml` is
 * a large generated file and the dashboard only ever needs this one scalar, so
 * shipping a YAML dependency to the browser for it isn't worth the bytes.
 * Quoted and unquoted forms are both handled; commented-out lines are skipped.
 */
export function extractCron(workflowYaml: string): string | null {
  for (const rawLine of workflowYaml.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("#")) continue;
    const match = /^-?\s*cron:\s*(?:"([^"]+)"|'([^']+)'|([^#]+?))\s*(?:#.*)?$/.exec(line);
    if (match) {
      const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (value !== "") return value;
    }
  }
  return null;
}
