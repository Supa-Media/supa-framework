/**
 * Which repo does this text belong to?
 *
 * A deliberately boring heuristic: count how many of each app's distinct
 * vocabulary terms appear in the text, and take the winner **only if it wins
 * outright**. A tie means the text spoke two domains' languages equally, which
 * is exactly the case the owner said should become `unassigned` rather than a
 * guess.
 *
 * Scoring counts *distinct terms matched*, not occurrences — saying "budget"
 * six times is one signal, not six. That stops a single repeated word from
 * outvoting a sentence that genuinely names three concepts from another app.
 */

import { FLEET_APPS, UNASSIGNED, type FleetApp } from "./fleet";

export interface AppScore {
  key: string;
  score: number;
  /** The vocabulary terms that matched, in declaration order. Useful in logs. */
  matched: string[];
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `term` appear in `haystack` as a whole word (or whole phrase)?
 *
 * `\b` on both ends, so "seat" doesn't match "seated" and "form" doesn't match
 * "performance" — a real false positive for the events-os vocabulary. Terms
 * that begin or end with a non-word character would break `\b`, but none do,
 * and adding one would show up as a routing test failure rather than silently.
 */
function containsTerm(haystack: string, term: string): boolean {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(haystack);
}

/** Score every app against `text`, highest first, ties left in declaration order. */
export function scoreApps(
  text: string,
  apps: readonly FleetApp[] = FLEET_APPS,
): AppScore[] {
  return apps
    .map((app) => {
      const matched = app.vocabulary.filter((term) => containsTerm(text, term));
      return { key: app.key, score: matched.length, matched };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * The app key `text` routes to, or {@link UNASSIGNED}.
 *
 * Returns `unassigned` when nothing matched (score 0) or when the top two apps
 * tied — both are "we don't know", and the owner would rather place it himself
 * than un-place a wrong guess.
 */
export function routeApp(
  text: string,
  apps: readonly FleetApp[] = FLEET_APPS,
): string {
  const scores = scoreApps(text, apps);
  const top = scores[0];
  if (top === undefined || top.score === 0) return UNASSIGNED;

  const runnerUp = scores[1];
  if (runnerUp !== undefined && runnerUp.score === top.score) return UNASSIGNED;

  return top.key;
}
