/**
 * Validating what the extraction model handed back.
 *
 * The request asks for a JSON schema (`output_config.format`), so conforming
 * output is the normal case — but "normal case" isn't "guaranteed". A response
 * truncated at `max_tokens`, a refusal, or a model that decided to wrap the
 * object in a ```json fence all produce something this worker would otherwise
 * file into GitHub as-is. Everything downstream of here creates real issues in
 * real repos, so it validates.
 *
 * The validator is hand-rolled rather than zod: the package is dependency-free
 * (see tsconfig.json), the shape is two arrays of flat objects, and the
 * interesting behavior isn't "does it match a schema" — it's the coercion
 * policy below, which no schema library would express for us anyway.
 *
 * **Coercion policy.** A malformed *field* degrades; a malformed *document*
 * fails. Losing an item the owner dictated is worse than filing one with a
 * default size, so a bad `size` becomes `m` and an unknown `app` becomes
 * `unassigned` — both recorded as warnings. A missing `title`, though, leaves
 * nothing to file, so that item is dropped with a warning. Only a response
 * that isn't an object, or whose `items` isn't an array, is a hard failure.
 */

import { UNASSIGNED, appByKey } from "./fleet";

export type ItemSize = "s" | "m" | "l";

export interface ExtractedItem {
  title: string;
  acceptance_criteria: string[];
  /** A fleet app key, or {@link UNASSIGNED}. */
  app: string;
  /** Initiative name. Never empty — falls back to `misc`. */
  initiative: string;
  /** True when the model proposed an initiative that doesn't exist yet. */
  is_new_initiative: boolean;
  size: ItemSize;
  /** Verbatim slice of the transcript this item came from. May be empty. */
  source_quote: string;
}

export type PlanEditType = "reprioritize" | "cancel" | "modify";

export interface PlanEdit {
  type: PlanEditType;
  /** What the edit applies to — an initiative, an issue, a plan by name. */
  target: string;
  app: string;
  reason: string;
}

export interface Extraction {
  items: ExtractedItem[];
  plan_edits: PlanEdit[];
}

export type ParseResult =
  | { ok: true; value: Extraction; warnings: string[] }
  | { ok: false; errors: string[] };

/** The initiative an item gets when the model didn't name one. */
export const DEFAULT_INITIATIVE = "misc";

const SIZES: readonly ItemSize[] = ["s", "m", "l"];
const PLAN_EDIT_TYPES: readonly PlanEditType[] = [
  "reprioritize",
  "cancel",
  "modify",
];

/**
 * Pull a JSON object out of a model response that may be wrapped in prose or a
 * fenced code block.
 *
 * Slices from the first `{` to the last `}` rather than trying to parse the
 * fence syntax — a fence is only one of the ways a model wraps JSON, and the
 * outermost braces bound the object under every one of them. Returns the input
 * unchanged when there are no braces, so the caller's `JSON.parse` produces the
 * real syntax error rather than one this function invented.
 */
export function extractJsonBlock(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text.trim();
  return text.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asTrimmedString(entry))
    .filter((entry) => entry !== "");
}

function parseItem(
  raw: unknown,
  index: number,
  warnings: string[],
): ExtractedItem | null {
  if (!isRecord(raw)) {
    warnings.push(`items[${index}]: not an object — dropped`);
    return null;
  }

  const title = asTrimmedString(raw["title"]);
  if (title === "") {
    warnings.push(`items[${index}]: missing title — dropped`);
    return null;
  }

  let app = asTrimmedString(raw["app"]).toLowerCase();
  if (app !== UNASSIGNED && appByKey(app) === null) {
    if (app !== "") warnings.push(`items[${index}]: unknown app "${app}"`);
    app = UNASSIGNED;
  }

  // The prompt asks for exactly one of `initiative` (existing) or
  // `new_initiative` (proposed). Both present means the model hedged; the
  // existing one wins, because filing under a real initiative is recoverable
  // and inventing a duplicate one is noise.
  const existing = asTrimmedString(raw["initiative"]);
  const proposed = asTrimmedString(raw["new_initiative"]);
  const initiative = existing !== "" ? existing : proposed;
  const isNew = existing === "" && proposed !== "";

  const rawSize = asTrimmedString(raw["size"]).toLowerCase();
  const size = SIZES.find((candidate) => candidate === rawSize);
  if (size === undefined && rawSize !== "") {
    warnings.push(`items[${index}]: unknown size "${rawSize}" — using m`);
  }

  return {
    title,
    acceptance_criteria: asStringArray(raw["acceptance_criteria"]),
    app,
    initiative: initiative === "" ? DEFAULT_INITIATIVE : initiative,
    is_new_initiative: isNew,
    size: size ?? "m",
    source_quote: asTrimmedString(raw["source_quote"]),
  };
}

function parsePlanEdit(
  raw: unknown,
  index: number,
  warnings: string[],
): PlanEdit | null {
  if (!isRecord(raw)) {
    warnings.push(`plan_edits[${index}]: not an object — dropped`);
    return null;
  }

  const rawType = asTrimmedString(raw["type"]).toLowerCase();
  const type = PLAN_EDIT_TYPES.find((candidate) => candidate === rawType);
  if (type === undefined) {
    warnings.push(`plan_edits[${index}]: unknown type "${rawType}" — dropped`);
    return null;
  }

  const target = asTrimmedString(raw["target"]);
  if (target === "") {
    warnings.push(`plan_edits[${index}]: missing target — dropped`);
    return null;
  }

  let app = asTrimmedString(raw["app"]).toLowerCase();
  if (app !== UNASSIGNED && appByKey(app) === null) app = UNASSIGNED;

  return { type, target, app, reason: asTrimmedString(raw["reason"]) };
}

/**
 * Validate a parsed extraction response.
 *
 * Takes `unknown` (not a string) so the caller can hand over either
 * `JSON.parse(extractJsonBlock(text))` or a structured-output object without
 * this function caring which.
 */
export function parseExtraction(raw: unknown): ParseResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ["response is not a JSON object"] };
  }

  const rawItems = raw["items"];
  if (!Array.isArray(rawItems)) {
    return { ok: false, errors: ["`items` is missing or not an array"] };
  }

  const rawPlanEdits = raw["plan_edits"];
  if (rawPlanEdits !== undefined && !Array.isArray(rawPlanEdits)) {
    return { ok: false, errors: ["`plan_edits` is present but not an array"] };
  }

  const warnings: string[] = [];
  const items: ExtractedItem[] = [];
  rawItems.forEach((entry, index) => {
    const item = parseItem(entry, index, warnings);
    if (item !== null) items.push(item);
  });

  const planEdits: PlanEdit[] = [];
  (rawPlanEdits ?? []).forEach((entry: unknown, index: number) => {
    const edit = parsePlanEdit(entry, index, warnings);
    if (edit !== null) planEdits.push(edit);
  });

  return { ok: true, value: { items, plan_edits: planEdits }, warnings };
}
