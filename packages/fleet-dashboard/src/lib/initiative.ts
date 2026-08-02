/**
 * Branch → initiative.
 *
 * An "initiative" is the branch prefix: everything before the last `/` segment.
 * It is how ACTIVE WORK groups PRs under a project, and it works because every
 * repo in the fleet already names branches `<initiative>/<slug>`:
 *
 *   wa-parity/chat-polish   → wa-parity
 *   claude/devbug-x97d9e1   → claude
 *   feat/finance/v2-split   → feat/finance   (only the LAST segment is dropped)
 *   main                    → misc           (no prefix at all)
 *
 * Note this deliberately keeps multi-level prefixes intact rather than taking
 * only the first segment — `feat/finance/*` and `feat/people/*` are different
 * initiatives that happen to share a `feat/` convention.
 */

export const MISC_INITIATIVE = "misc";

/**
 * Conventional-commit prefixes. `feat/thread-replies` is a commit convention
 * wearing a slash, not a project — and a fleet that names branches this way was
 * rendering seven cards called `chore`, `feat`, `fix`, `perf`… each announcing
 * that it had no manifest entry.
 */
export const CONVENTIONAL_PREFIXES: readonly string[] = [
  "feat",
  "fix",
  "chore",
  "docs",
  "test",
  "tests",
  "refactor",
  "perf",
  "ci",
  "build",
  "style",
  "revert",
  "release",
  "hotfix",
];

/** Prefixes an agent harness or a bot generates. Never a human naming a project. */
export const HARNESS_PREFIXES: readonly string[] = [
  "claude",
  "cursor",
  "codex",
  "agents",
  "agent-workflow",
  "worktree-agent",
  "dependabot",
  "renovate",
  "gardener",
  "aw",
];

const CONVENTIONAL = new Set(CONVENTIONAL_PREFIXES);
const HARNESS = new Set(HARNESS_PREFIXES);

/**
 * Is this inferred key noise rather than an initiative?
 *
 * The two lists are matched differently, and the asymmetry is the point:
 *
 *   - a **conventional** prefix is noise only when it is the *whole* key. `feat`
 *     names nothing, but `feat/finance` names finance — and the manifest may well
 *     have an entry for it. Collapsing both would throw away the one case where
 *     a conventional prefix carries real information.
 *   - a **harness** prefix is noise at any depth. `claude/…`, `worktree-agent/…`
 *     and `dependabot/npm_and_yarn/…` are machine-generated all the way down;
 *     there is no second segment at which one of them becomes a project.
 *
 * Applies only to keys inferred from a branch. A manifest entry or an `init:*`
 * label named `fix` is a human saying so, and a human outranks this list.
 */
export function isNoisyInitiative(name: string): boolean {
  const key = name.trim().toLowerCase();
  if (key === "" || key === MISC_INITIATIVE) return true;
  if (CONVENTIONAL.has(key)) return true;
  return HARNESS.has(key.split("/")[0] ?? "");
}

export function initiativeFromBranch(branch: string): string {
  const trimmed = branch.trim().replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return MISC_INITIATIVE;

  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash === -1) return MISC_INITIATIVE;

  // Collapse the `a//b` case that `replace` above doesn't reach.
  const prefix = trimmed
    .slice(0, lastSlash)
    .split("/")
    .filter((segment) => segment !== "")
    .join("/");

  return prefix === "" ? MISC_INITIATIVE : prefix;
}

/**
 * Group items by initiative, sorted so `misc` sinks to the bottom and the rest
 * are alphabetical. Stable within a group — callers sort `items` first.
 */
export function groupByInitiative<T>(
  items: readonly T[],
  initiativeOf: (item: T) => string,
): Array<{ name: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = initiativeOf(item);
    const bucket = groups.get(name);
    if (bucket) bucket.push(item);
    else groups.set(name, [item]);
  }

  return [...groups.entries()]
    .map(([name, groupItems]) => ({ name, items: groupItems }))
    .sort((a, b) => {
      if (a.name === MISC_INITIATIVE) return 1;
      if (b.name === MISC_INITIATIVE) return -1;
      return a.name.localeCompare(b.name);
    });
}
