/**
 * The merge rule from `types.ts`, in one place and nowhere else.
 *
 * The seam notes say: merge by `ProjectSnapshot.key`; the later source wins for
 * scalar fields and appends to list fields. This implements exactly that, with
 * one refinement the prose leaves implicit and the code cannot:
 *
 *   **`null` is "I don't know", not "the answer is nothing".** A source that
 *   never looked at spend must not blank the spend GitHub reported by being
 *   listed second. So a later `null` leaves an earlier value standing, while a
 *   later *value* replaces an earlier one — including replacing it with a
 *   smaller number, which is a real observation.
 *
 * List fields append and then de-duplicate by id, because every card the
 * dashboard renders is keyed by a stable id and two sources describing the same
 * PR should produce one row, not two identical ones. First occurrence wins the
 * position; the later source's copy wins the content, for the same reason its
 * scalars do.
 */

import { emptySnapshot, type FleetSnapshot, type ProjectSnapshot } from "./types";

/** Fold snapshots left to right. Empty input is the identity snapshot. */
export function mergeSnapshots(snapshots: readonly FleetSnapshot[]): FleetSnapshot {
  const present = snapshots.filter((snapshot) => snapshot !== undefined);
  if (present.length === 0) return emptySnapshot();
  const first = present[0];
  if (first === undefined) return emptySnapshot();
  if (present.length === 1) return first;
  return present.reduce(mergePair);
}

function mergePair(earlier: FleetSnapshot, later: FleetSnapshot): FleetSnapshot {
  return {
    // The newest observation, so "as of" never goes backwards because a cheap
    // source answered after an expensive one.
    fetchedAt: newest(earlier.fetchedAt, later.fetchedAt),
    since: later.since,
    projects: mergeProjects(earlier.projects, later.projects),
    needsYou: dedupeById([...earlier.needsYou, ...later.needsYou]),
    shipped: dedupeById([...earlier.shipped, ...later.shipped]),
    issues: dedupeById([...earlier.issues, ...later.issues]),
    runEvents: dedupeById([...earlier.runEvents, ...later.runEvents]).sort((a, b) =>
      b.at.localeCompare(a.at),
    ),
    spendReportedUsd: later.spendReportedUsd ?? earlier.spendReportedUsd,
    spendReportedAt: later.spendReportedAt ?? earlier.spendReportedAt,
    // Errors never dedupe: two sources failing on the same repo for different
    // reasons is two things to fix, and collapsing them would hide one.
    errors: [...earlier.errors, ...later.errors],
    rateLimit: later.rateLimit ?? earlier.rateLimit,
  };
}

function mergeProjects(
  earlier: readonly ProjectSnapshot[],
  later: readonly ProjectSnapshot[],
): ProjectSnapshot[] {
  const merged: ProjectSnapshot[] = earlier.map((project) => ({ ...project }));
  const byKey = new Map(merged.map((project, index) => [project.key, index]));

  for (const project of later) {
    const index = byKey.get(project.key);
    if (index === undefined) {
      merged.push({ ...project });
      byKey.set(project.key, merged.length - 1);
      continue;
    }
    const existing = merged[index];
    if (existing === undefined) continue;
    merged[index] = {
      ...existing,
      ...project,
      initiatives: [...existing.initiatives, ...project.initiatives],
      gardeners: [...existing.gardeners, ...project.gardeners],
      // `null` here means "this token could not see the secret names", which is
      // a different answer from an empty list and must not be overwritten by a
      // source that never asked.
      secretNames: project.secretNames ?? existing.secretNames,
    };
  }

  return merged;
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const order: string[] = [];
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  return order.map((id) => byId.get(id)).filter((item): item is T => item !== undefined);
}

function newest(a: string, b: string): string {
  return a.localeCompare(b) >= 0 ? a : b;
}
