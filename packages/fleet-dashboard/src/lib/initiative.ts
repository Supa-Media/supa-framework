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
