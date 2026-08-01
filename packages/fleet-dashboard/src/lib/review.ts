/**
 * The review window, and what "shipped" means inside it.
 *
 * The ritual is twice a day, so "since your last review" is the only time axis
 * the home screen has. It is a single ISO timestamp in localStorage — the one
 * piece of state this app owns, because it is genuinely about *you*, not about
 * the fleet, and putting it in GitHub would mean a write on every glance.
 */

const REVIEWED_KEY = "fleet-dashboard:last-reviewed";

/** Twelve hours: the gap between a morning and an evening review. */
export const DEFAULT_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * When the last review was marked done.
 *
 * A first-run browser has no stamp, and defaulting to the epoch would open the
 * ritual with every PR ever merged. It defaults to one window back instead —
 * the same thing the second review of the day sees.
 */
export function readLastReviewed(now: Date = new Date()): string {
  try {
    const raw = localStorage.getItem(REVIEWED_KEY);
    if (raw !== null && !Number.isNaN(new Date(raw).getTime())) return raw;
  } catch {
    // Storage disabled — behave like a first run.
  }
  return new Date(now.getTime() - DEFAULT_WINDOW_MS).toISOString();
}

export function writeLastReviewed(at: string): void {
  try {
    localStorage.setItem(REVIEWED_KEY, at);
  } catch {
    // Private mode: the stamp lasts for this page load only, which is still
    // the correct behaviour for the session you are in.
  }
}

/** Morning or evening — only used to title the screen honestly. */
export function reviewLabel(now: Date = new Date()): string {
  return now.getHours() < 14 ? "morning review" : "evening review";
}

export type ProdState = "in-production" | "awaiting-production" | "unknown";

/**
 * Has a merge reached production?
 *
 * Staging deploys on merge everywhere in the fleet, so staging needs no
 * computing — a merged PR is on staging. Production is a separate,
 * human-triggered workflow, so the question is whether the newest *successful*
 * production run finished after this PR merged.
 *
 * `unknown` when there is no production run to compare against. It is not
 * `awaiting`: a repo whose production workflow the token cannot see would
 * otherwise show every merge as undeployed, and the one screen designed to be
 * trusted at 7am would be crying wolf on all of them.
 */
export function prodState(mergedAt: string, latestProdRunAt: string | null): ProdState {
  if (latestProdRunAt === null) return "unknown";
  const merged = new Date(mergedAt).getTime();
  const deployed = new Date(latestProdRunAt).getTime();
  if (!Number.isFinite(merged) || !Number.isFinite(deployed)) return "unknown";
  return deployed >= merged ? "in-production" : "awaiting-production";
}
