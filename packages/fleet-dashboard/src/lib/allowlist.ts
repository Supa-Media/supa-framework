/**
 * The secrets matrix: rows are keys, columns are repos.
 *
 * Every repo in the fleet runs the same 1Password → GitHub → Convex/EAS flow
 * and every repo keeps its allowlist somewhere different
 * (`ee/`, `.github/`, `scripts/`) with a slightly different shape. One matrix
 * is the only way to see, in a glance, that `STRIPE_SECRET_KEY` is required in
 * two repos and absent from a third that has started charging cards.
 *
 * Two independent facts per cell, never conflated:
 *
 *   - **listed** — the key appears in that repo's allowlist, as `required`
 *     (the sync aborts without it) or `optional` (the sync *prunes* it from
 *     GitHub when 1Password has no value).
 *   - **secret** — a GitHub Actions secret of that name exists. Reading this
 *     needs an admin-scoped token, so it is `null` (unknown) far more often
 *     than it is false, and the UI must say "allowlist only" rather than
 *     render an unknown as a missing secret.
 *
 * 1Password presence is a third fact this cannot see at all — it needs a
 * service account, which does not exist yet. The column says so.
 */

export type SecretTier = "required" | "optional";

export interface Allowlist {
  required: string[];
  optional: string[];
  /** Populated when the file could not be read as an allowlist. */
  problem: string | null;
}

export interface MatrixCell {
  /** `null` when the repo's allowlist does not mention the key. */
  tier: SecretTier | null;
  /**
   * Whether a GitHub Actions secret of this name exists.
   * `null` = not checked / no permission, and must render as "unknown".
   */
  secretExists: boolean | null;
}

export interface MatrixRow {
  key: string;
  /** Indexed by repo key (`owner/name` lowercased), same order as the columns. */
  cells: MatrixCell[];
}

const EMPTY: Allowlist = { required: [], optional: [], problem: null };

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/**
 * Parse one repo's allowlist JSON.
 *
 * Shape-tolerant on purpose: the three files in the fleet differ already
 * (`$comment` vs `_comment`, `optional` present or absent), and a fourth repo
 * scaffolded tomorrow will differ again. Only `required`/`optional` are read;
 * everything else is documentation for humans.
 */
export function parseAllowlist(json: string | null | undefined): Allowlist {
  if (typeof json !== "string" || json.trim() === "") return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      required: [],
      optional: [],
      problem: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { required: [], optional: [], problem: "expected a JSON object" };
  }

  const record = parsed as Record<string, unknown>;
  const required = stringArray(record["required"]);
  const optional = stringArray(record["optional"]);

  if (required.length === 0 && optional.length === 0) {
    return { required, optional, problem: "no `required` or `optional` keys" };
  }
  return { required, optional, problem: null };
}

/** Which tier a key sits in, or `null` when the repo does not list it. */
export function tierOf(allowlist: Allowlist, key: string): SecretTier | null {
  if (allowlist.required.includes(key)) return "required";
  if (allowlist.optional.includes(key)) return "optional";
  return null;
}

export interface RepoSecrets {
  repoKey: string;
  allowlist: Allowlist;
  /**
   * Names of the repo's GitHub Actions secrets, or `null` when the token could
   * not read them (403 — the endpoint needs admin). `null` is not an empty set:
   * one means "no secrets", the other means "I don't know", and the matrix must
   * not flatten the second into the first.
   */
  secretNames: string[] | null;
}

/**
 * Build the matrix: the union of every repo's allowlisted keys, sorted, one row
 * each. Keys are unioned rather than intersected because the interesting rows
 * are exactly the ones where repos disagree.
 */
export function buildMatrix(repos: readonly RepoSecrets[]): MatrixRow[] {
  const keys = new Set<string>();
  for (const repo of repos) {
    for (const key of repo.allowlist.required) keys.add(key);
    for (const key of repo.allowlist.optional) keys.add(key);
  }

  return [...keys].sort().map((key) => ({
    key,
    cells: repos.map((repo) => {
      const tier = tierOf(repo.allowlist, key);
      return {
        tier,
        // Only ask the question where it means something. A repo that doesn't
        // list the key has no opinion about whether a secret of that name
        // exists, and reporting "missing" there would invent a problem.
        secretExists: tier === null || repo.secretNames === null ? null : repo.secretNames.includes(key),
      };
    }),
  }));
}

/**
 * Rows worth acting on: a key a repo requires but has no GitHub secret for.
 * Unknown (`null`) never counts — this drives a warning banner, and a warning
 * that fires on "I couldn't check" is a warning nobody reads twice.
 */
export function missingRequired(rows: readonly MatrixRow[]): MatrixRow[] {
  return rows.filter((row) =>
    row.cells.some((cell) => cell.tier === "required" && cell.secretExists === false),
  );
}
