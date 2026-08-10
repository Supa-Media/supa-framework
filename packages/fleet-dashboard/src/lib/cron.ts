/**
 * Cron parsing for the GARDENERS table: a 5-field GitHub Actions `schedule`
 * expression in, a human sentence and the next fire time out.
 *
 * Scope is deliberately the subset GitHub Actions actually accepts and that
 * gh-aw workflows actually use: `*`, fixed numbers, `a-b` ranges, `a,b` lists,
 * and `*` / range with a `/step`. No `@daily` macros (Actions rejects them), no
 * `L`/`W`/`#` (Quartz-only). Anything unparseable degrades to
 * `unrecognized schedule (<raw>)` rather than throwing — a gardener with a
 * weird cron should still show its last run, and a visibly-unrecognized cell
 * is far better than a confident sentence built from a misread expression.
 * Validation is therefore deliberately strict: a field that isn't exactly the
 * accepted grammar is rejected, never coerced.
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

/**
 * Strict integer parse. `Number` is far too generous for validating cron
 * fields — it accepts `""` (0), `" 5 "`, `0x10`, `1e2` and `+3`, every one of
 * which would turn a malformed expression into a plausible-looking schedule.
 */
function toInt(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** Expand one cron field into the sorted list of values it matches. */
function expandField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const slashSplit = part.split("/");
    // `a/b/c` is not a thing; at most one step.
    if (slashSplit.length > 2) return null;
    const [rangePart, stepPart] = slashSplit;
    if (rangePart === undefined || rangePart === "") return null;

    let step = 1;
    if (stepPart !== undefined) {
      step = toInt(stepPart);
      if (!Number.isInteger(step) || step < 1) return null;
    }

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      // Exactly two non-empty bounds. Without this, `Number("")` is 0, so
      // `-5` reads as `0-5` and `1-5-7` silently discards the third bound —
      // both rendering a confident, wrong sentence instead of degrading.
      const bounds = rangePart.split("-");
      if (bounds.length !== 2) return null;
      const [a, b] = bounds as [string, string];
      if (a === "" || b === "") return null;
      start = toInt(a);
      end = toInt(b);
    } else {
      start = toInt(rangePart);
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

/**
 * The most times worth spelling out in a phone-width table cell. Past this the
 * list stops being scannable and a summary is more useful than the truth.
 */
const MAX_LISTED_TIMES = 4;

/**
 * `at 09:00 UTC`, or `at 09:00, 09:15, 12:00, 12:15 UTC, +4 more` once the
 * cartesian product of hours × minutes outgrows a phone-width cell. The
 * overflow marker sits after the zone so the times and their zone stay
 * adjacent.
 */
function timesOfDay(fields: CronFields): string {
  const times: string[] = [];
  for (const hour of fields.hours) {
    for (const minute of fields.minutes) times.push(`${pad(hour)}:${pad(minute)}`);
  }
  if (times.length <= MAX_LISTED_TIMES) return `at ${times.join(", ")} UTC`;
  const shown = times.slice(0, MAX_LISTED_TIMES).join(", ");
  return `at ${shown} UTC, +${times.length - MAX_LISTED_TIMES} more`;
}

interface Step {
  step: number;
  /** First value in the run. */
  from: number;
  /** Last value in the run. */
  to: number;
  /** True when the run spans the field's whole range (`*​/n` rather than `a-b/n`). */
  spansField: boolean;
}

/**
 * Recognize an evenly-stepped field, anchored anywhere.
 *
 * The earlier version required the run to start at the field minimum, so an
 * entirely ordinary business-hours cadence like `*​/30 9-17 * * 1-5` fell
 * through to an 18-entry cartesian list. Reporting the anchor lets the caller
 * phrase it as a window instead.
 */
function evenStep(values: number[], min: number, max: number): Step | null {
  if (values.length < 2) return null;
  const first = values[0] as number;
  const last = values[values.length - 1] as number;
  const step = (values[1] as number) - first;

  for (let i = 1; i < values.length; i += 1) {
    if ((values[i] as number) - (values[i - 1] as number) !== step) return null;
  }

  // Whole-field only if it starts at the minimum and the next step would
  // overshoot the maximum — otherwise it's a bounded window.
  const spansField = first === min && last + step > max;
  return { step, from: first, to: last, spansField };
}

function listDays(days: number[]): string {
  if (days.length === 7) return "every day";
  if (days.length === 5 && days.join() === "1,2,3,4,5") return "weekdays";
  if (days.length === 2 && days.join() === "0,6") return "weekends";
  return days.map((day) => DAY_NAMES[day] ?? `day ${day}`).join(", ");
}

/** The day/date scope a schedule repeats over: "weekdays", "daily", … */
function scopeOf(fields: CronFields): string {
  if (!fields.wildcard.dayOfWeek) return listDays(fields.daysOfWeek);
  if (!fields.wildcard.dayOfMonth) {
    const days = fields.daysOfMonth.join(", ");
    return `${fields.wildcard.month ? "monthly" : "yearly"} on day ${days}`;
  }
  return "daily";
}

/**
 * Render one cron expression as a short English phrase, e.g.
 * "Mondays at 09:00 UTC", "every 6 hours", "every 30 min 09:00–17:30 UTC".
 *
 * Returns `unrecognized schedule (<raw>)` when the expression can't be parsed —
 * the module's contract is to degrade visibly rather than assert something
 * plausible and wrong, and a bare raw string in the Schedule column reads as a
 * rendering bug rather than as "go look at this".
 */
export function describeCron(expression: string): string {
  const raw = expression.trim();
  const fields = parseCron(raw);
  if (!fields) return `unrecognized schedule (${raw})`;

  const { wildcard } = fields;

  // Sub-hourly across the whole day: `*/15 * * * *`
  if (!wildcard.minute && wildcard.hour && wildcard.dayOfMonth && wildcard.dayOfWeek) {
    const minuteStep = evenStep(fields.minutes, 0, 59);
    if (minuteStep?.spansField) {
      return minuteStep.step === 1 ? "every minute" : `every ${minuteStep.step} minutes`;
    }
  }
  if (wildcard.minute) {
    // A bare `*` minute means 60 runs an hour — call it out plainly.
    return `every minute${wildcard.hour ? "" : ` ${timesOfDay(fields)}`}`;
  }

  const scope = scopeOf(fields);
  const at = timesOfDay(fields);

  // Hourly steps: `0 */6 * * *`, and plain hourly `0 * * * *`.
  if (wildcard.dayOfMonth && wildcard.dayOfWeek && fields.minutes.length === 1) {
    const hourStep = evenStep(fields.hours, 0, 23);
    if (hourStep?.spansField) {
      const minute = fields.minutes[0] as number;
      const suffix = minute === 0 ? "" : ` at :${pad(minute)}`;
      return hourStep.step === 1 ? `hourly${suffix}` : `every ${hourStep.step} hours${suffix}`;
    }
  }

  // Windowed steps: `*/30 9-17 * * 1-5` → "weekdays every 30 min 09:00–17:30 UTC".
  // Without this, the cartesian product below prints 18 timestamps into a
  // phone-width cell.
  const window = describeWindow(fields);
  if (window !== null) return `${scope} ${window}`;

  return `${scope} ${at}`;
}

/**
 * Phrase a stepped schedule as a window when either the minutes or the hours
 * step evenly and the other field is a single value or also stepped.
 */
function describeWindow(fields: CronFields): string | null {
  const minuteStep = evenStep(fields.minutes, 0, 59);
  const hourStep = evenStep(fields.hours, 0, 23);

  const first = `${pad(fields.hours[0] as number)}:${pad(fields.minutes[0] as number)}`;
  const lastHour = fields.hours[fields.hours.length - 1] as number;
  const lastMinute = fields.minutes[fields.minutes.length - 1] as number;
  const last = `${pad(lastHour)}:${pad(lastMinute)}`;

  // Minutes step within a CONTIGUOUS run of hours: `*/30 9-17 * * *`.
  //
  // Contiguity is what makes the phrasing true, and it has two halves.
  //
  //  - The HOURS must run consecutively. With hours `9,12,15,18` the schedule
  //    does not fire every 30 min from 09:00 to 18:30 — it fires twice in each
  //    of four hours — so that case falls through to a listing.
  //  - The MINUTES must join up across the hour boundary. `0,15 * * * *` steps
  //    by 15 inside the hour and then waits 45 minutes for the next hour's
  //    `:00`, so "every 15 min" is false for a schedule that fires twice an
  //    hour. The gap over the boundary is `60 - last + first` and it has to
  //    equal the step. A single hour has no boundary to cross, so the question
  //    does not arise there.
  const hoursContiguous = fields.hours.length === 1 || hourStep?.step === 1;
  const minutesJoinUp =
    fields.hours.length === 1 ||
    (minuteStep !== null && 60 - lastMinute + (fields.minutes[0] as number) === minuteStep.step);
  if (
    minuteStep &&
    minuteStep.step > 1 &&
    fields.minutes.length > 1 &&
    hoursContiguous &&
    minutesJoinUp
  ) {
    return `every ${minuteStep.step} min ${first}–${last} UTC`;
  }

  // Hours step, one fixed minute: `0 1-23/2 * * *`. Three or more values, since
  // two timestamps are clearer listed than described as an interval.
  if (hourStep && hourStep.step > 1 && fields.minutes.length === 1 && fields.hours.length >= 3) {
    return `every ${hourStep.step}h ${first}–${last} UTC`;
  }

  return null;
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

const CRON_LINE = /^-?\s*cron:\s*(?:"([^"]+)"|'([^']+)'|([^#]+?))\s*(?:#.*)?$/;

/**
 * Pull every `cron:` value out of a workflow YAML's `schedule:` block.
 *
 * A regex scan rather than a YAML parser on purpose: a compiled gh-aw
 * `.lock.yml` is a large generated file and the dashboard only ever needs these
 * few scalars, so shipping a YAML dependency to the browser isn't worth the
 * bytes. Two things the naive version got wrong, both fixed here:
 *
 *  - **Scope.** Compiled lock files embed the agent's prompt inside `run: |`
 *    blocks, and a maintenance workflow that *reasons about schedules* will
 *    happily contain the text `cron: 0 0 * * *`. Matching only inside a
 *    `schedule:` block — tracked by indentation — keeps prose out.
 *  - **Multiplicity.** A workflow may declare several `- cron:` entries. Taking
 *    only the first understates the cadence and, worse, makes `nextRun` point
 *    past a fire that will really happen.
 */
export function extractCrons(workflowYaml: string): string[] {
  const crons: string[] = [];
  let scheduleIndent: number | null = null;

  for (const rawLine of workflowYaml.split("\n")) {
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;

    if (scheduleIndent !== null && indent <= scheduleIndent) {
      // De-indented back to (or past) `schedule:` — the block is over.
      scheduleIndent = null;
    }

    if (/^schedule:\s*(?:#.*)?$/.test(rawLine.trim())) {
      scheduleIndent = indent;
      continue;
    }

    if (scheduleIndent === null) continue;

    const match = CRON_LINE.exec(rawLine.trim());
    if (!match) continue;
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value !== "") crons.push(value);
  }

  return crons;
}

/** Render several crons as one Schedule cell. */
export function describeCrons(crons: readonly string[]): string {
  if (crons.length === 0) return "manual / event-driven";
  return crons.map(describeCron).join("; ");
}

/** Soonest next fire across every cron on the workflow. */
export function nextRunAcross(crons: readonly string[], from: Date = new Date()): Date | null {
  let soonest: Date | null = null;
  for (const cron of crons) {
    const candidate = nextRun(cron, from);
    if (candidate !== null && (soonest === null || candidate < soonest)) soonest = candidate;
  }
  return soonest;
}
