/**
 * `.fleet/initiatives.json` — the optional manifest that names a repo's
 * initiatives and what phase each is in.
 *
 * The Apps view can always *find* initiatives without this file: they are
 * inferred from `init:*` labels and branch prefixes. What inference cannot
 * supply is the two things a human writes down — what phase the work is in, and
 * that an initiative is finished and should stop taking up nav space. Hence a
 * file, in the repo, changed by a normal commit.
 *
 * Schema (every field but `name` optional):
 *
 *     {
 *       "initiatives": [
 *         {
 *           "name": "giving",              // must match the `init:giving` label
 *           "phase": "hardening",          // idea|building|launched|hardening|quiet|done
 *           "spec": "docs/plans/giving.md",// repo-relative path to the spec
 *           "archived": false              // hides it behind "archived" on the app view
 *         }
 *       ]
 *     }
 *
 * A bare array is accepted too, because that is what people write first.
 *
 * Parsing is total: a malformed file yields the entries that were readable plus
 * a list of problems the UI shows. A dashboard that blanked an app's page
 * because someone left a trailing comma would be worse than no manifest at all.
 */

export const INITIATIVE_PHASES = [
  "idea",
  "building",
  "launched",
  "hardening",
  "quiet",
  "done",
] as const;

export type InitiativePhase = (typeof INITIATIVE_PHASES)[number];

export interface InitiativeEntry {
  name: string;
  /** `null` when unset or unrecognized — never guessed. */
  phase: InitiativePhase | null;
  /** Repo-relative path to the spec, or `null`. */
  spec: string | null;
  archived: boolean;
}

export interface InitiativesManifest {
  entries: InitiativeEntry[];
  /** Human-readable problems, shown beside the app's initiative cards. */
  problems: string[];
}

const EMPTY: InitiativesManifest = { entries: [], problems: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPhase(value: unknown): InitiativePhase | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return (INITIATIVE_PHASES as readonly string[]).includes(lower)
    ? (lower as InitiativePhase)
    : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Parse the manifest's JSON text. `""` (no file) is not an error. */
export function parseInitiatives(json: string | null | undefined): InitiativesManifest {
  if (typeof json !== "string" || json.trim() === "") return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { entries: [], problems: [`initiatives.json is not valid JSON: ${message(error)}`] };
  }

  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed["initiatives"])
      ? (parsed["initiatives"] as unknown[])
      : null;

  if (raw === null) {
    return {
      entries: [],
      problems: ['initiatives.json must be an array, or an object with an "initiatives" array.'],
    };
  }

  const entries: InitiativeEntry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  raw.forEach((item, index) => {
    if (!isRecord(item)) {
      problems.push(`entry ${index} is not an object`);
      return;
    }
    const name = readString(item["name"]);
    if (name === null) {
      problems.push(`entry ${index} has no "name"`);
      return;
    }
    // Duplicates are dropped rather than merged: two entries disagreeing about
    // a phase is a question only the author can answer, and rendering the last
    // one silently would hide the disagreement.
    if (seen.has(name)) {
      problems.push(`"${name}" is listed more than once; keeping the first`);
      return;
    }
    seen.add(name);

    if (item["phase"] !== undefined && readPhase(item["phase"]) === null) {
      problems.push(`"${name}" has an unknown phase ${JSON.stringify(item["phase"])}`);
    }

    entries.push({
      name,
      phase: readPhase(item["phase"]),
      spec: readString(item["spec"]),
      archived: item["archived"] === true,
    });
  });

  return { entries, problems };
}

/** Index a manifest by initiative name for O(1) lookup from a card. */
export function indexInitiatives(
  manifest: InitiativesManifest,
): Map<string, InitiativeEntry> {
  return new Map(manifest.entries.map((entry) => [entry.name, entry]));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
