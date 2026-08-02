import { RUN_EVENT_SOURCES, type RunEventSource } from "../schema";
import { MAX_CLOCK_SKEW_MS } from "./auth";

/**
 * Turning an untrusted POST body into rows, or into one sentence saying why not.
 *
 * Pure — no database, no request context — so the whole of it can be exercised
 * directly, and so the HTTP handler stays a thin shell around "authenticate,
 * parse, insert". A signed request is *authentic*, not *correct*: a CI job with
 * a typo holds the right secret, and the useful answer to it is a 400 that names
 * the field rather than a row full of `undefined`.
 */

export interface ParsedEvent {
  source: RunEventSource;
  repo: string;
  issueNumber?: number;
  kind: string;
  at: number;
  url?: string;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
}

export type ParseResult =
  | { ok: true; events: ParsedEvent[] }
  | { ok: false; message: string };

/** Most events one POST may carry. An overnight run reports tens, not thousands. */
export const MAX_BATCH = 100;
/** Longest `kind`. It is a label in a UI, not a place to put a stack trace. */
export const MAX_KIND_LENGTH = 64;
export const MAX_DEDUPE_KEY_LENGTH = 200;
/**
 * Largest raw body, in bytes. Generous for a batch of small events and far
 * below anything that would make an unauthenticated-until-verified request
 * expensive to receive.
 */
export const MAX_BODY_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `at` accepts unix milliseconds or an ISO-8601 string, and may not sit further
 * in the future than the request itself is allowed to.
 *
 * Both formats, because the writers are shell scripts and TypeScript in roughly
 * equal measure, and `date -u +%s` versus `new Date().toISOString()` should not
 * be a thing anyone has to look up to file an event.
 *
 * **Rejected, not clamped.** `by_at` is read newest-first, so an event dated in
 * the year 3000 sorts above everything in *every* window forever and no `since`
 * can exclude it — one panel permanently wrong because one shell script emitted
 * nanoseconds. Clamping to `now` would hide that by silently re-dating the row,
 * and a telemetry log whose timestamps we quietly rewrite is worth less than one
 * that refuses the row and names the field. The request is already
 * timestamp-bound by its signature; this is the same rule applied to what the
 * request carries.
 *
 * The past needs no ceiling: an old `at` simply falls outside the 30-day window
 * and disappears, which is the right behaviour.
 */
function parseAt(value: unknown, now: number): number | null {
  const at = readAt(value, now);
  if (at === null || at > now + MAX_CLOCK_SKEW_MS) return null;
  return at;
}

function readAt(value: unknown, now: number): number | null {
  if (value === undefined || value === null) return now;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function parseEvent(raw: unknown, index: number, now: number): ParsedEvent | string {
  const where = `events[${index}]`;
  if (!isRecord(raw)) return `${where} is not an object`;

  const { source, repo, kind } = raw;
  if (typeof source !== "string" || !(RUN_EVENT_SOURCES as readonly string[]).includes(source)) {
    return `${where}.source must be one of ${RUN_EVENT_SOURCES.join(", ")}`;
  }
  if (typeof repo !== "string" || !repo.includes("/") || repo.trim() === "") {
    return `${where}.repo must be an "owner/name" slug`;
  }
  if (typeof kind !== "string" || kind.trim() === "" || kind.length > MAX_KIND_LENGTH) {
    return `${where}.kind must be 1..${MAX_KIND_LENGTH} characters`;
  }

  const at = parseAt(raw.at, now);
  if (at === null) {
    return `${where}.at must be unix milliseconds or an ISO-8601 string, and not in the future`;
  }

  const event: ParsedEvent = {
    source: source as RunEventSource,
    // Lowercased to match `ProjectSnapshot.key`, which is what the dashboard
    // merges on. A `Supa-Media/events-os` event that stayed cased would land in
    // the log correctly and then match nothing on screen.
    repo: repo.trim().toLowerCase(),
    kind: kind.trim(),
    at,
  };

  if (raw.issueNumber !== undefined && raw.issueNumber !== null) {
    if (typeof raw.issueNumber !== "number" || !Number.isInteger(raw.issueNumber) || raw.issueNumber <= 0) {
      return `${where}.issueNumber must be a positive integer`;
    }
    event.issueNumber = raw.issueNumber;
  }

  if (raw.url !== undefined && raw.url !== null) {
    if (typeof raw.url !== "string" || !/^https?:\/\//.test(raw.url)) {
      return `${where}.url must be an http(s) URL`;
    }
    event.url = raw.url;
  }

  if (raw.dedupeKey !== undefined && raw.dedupeKey !== null) {
    if (
      typeof raw.dedupeKey !== "string" ||
      raw.dedupeKey.trim() === "" ||
      raw.dedupeKey.length > MAX_DEDUPE_KEY_LENGTH
    ) {
      return `${where}.dedupeKey must be 1..${MAX_DEDUPE_KEY_LENGTH} characters`;
    }
    event.dedupeKey = raw.dedupeKey.trim();
  }

  if (raw.payload !== undefined && raw.payload !== null) {
    if (!isRecord(raw.payload)) return `${where}.payload must be an object`;
    event.payload = raw.payload;
  }

  return event;
}

/**
 * Accepts either `{ events: [...] }` or one bare event object.
 *
 * The bare form exists so the README's `curl` recipe — the thing a person
 * actually runs when wiring a new writer up at 1am — is one line and not a
 * nested array.
 */
export function parseEventsBody(body: unknown, now: number): ParseResult {
  if (!isRecord(body)) return { ok: false, message: "Body must be a JSON object" };

  const raw = Array.isArray(body.events) ? body.events : [body];
  if (raw.length === 0) return { ok: false, message: "events must not be empty" };
  if (raw.length > MAX_BATCH) return { ok: false, message: `events must hold at most ${MAX_BATCH} items` };

  const events: ParsedEvent[] = [];
  for (const [index, item] of raw.entries()) {
    const parsed = parseEvent(item, index, now);
    if (typeof parsed === "string") return { ok: false, message: parsed };
    events.push(parsed);
  }
  return { ok: true, events };
}
