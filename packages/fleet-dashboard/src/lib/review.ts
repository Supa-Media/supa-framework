/**
 * The review window, and what "shipped" means inside it.
 *
 * The ritual is twice a day, so "since your last review" is the only time axis
 * the home screen has. It is genuinely about *you*, not about the fleet, so it
 * has never been in GitHub — putting it there would mean a public write on
 * every glance.
 *
 * It lives in **two** places now, in this order:
 *
 *   1. localStorage, always. This is the offline fallback and the only store a
 *      dashboard with no backend configured has. Writing it first means marking
 *      reviewed still works on a train.
 *   2. The Convex backend, when one is configured (`lib/backend.ts`), so the
 *      marker follows you from the phone you did the morning review on to the
 *      laptop you do the evening one on.
 *
 * Reconciling the two is `reconcileMarks`, below — last write wins by
 * `updatedAt`, which is why the stored value grew from a bare timestamp into a
 * record. See `readLocalMark` for how the bare form is still read.
 */

const REVIEWED_KEY = "fleet-dashboard:last-reviewed";

/** Twelve hours: the gap between a morning and an evening review. */
export const DEFAULT_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * One "I have reviewed up to here", with enough context to lose an argument
 * with another device gracefully.
 */
export interface ReviewMark {
  /** ISO-8601 — the `since` the home screen is relative to. */
  lastReviewedAt: string;
  /** Unix ms of when the mark was *made*. The merge clock, not the window. */
  updatedAt: number;
  /** Which browser made it, so a surprising marker is traceable to a device. */
  device: string;
}

/** The `getItem`/`setItem`/`removeItem` subset used here, so storage is injectable. */
export interface MarkStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStore(): MarkStore | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * This browser's mark, or `null` on a first run.
 *
 * Reads **both** formats. v2 stored a bare ISO string under the same key and
 * that string is still in a browser somewhere; it is read as a mark whose
 * `updatedAt` is the timestamp itself. That is not the moment the button was
 * pressed, but it is monotone in the right direction and it is the only clock
 * that value ever had — the alternative, treating it as epoch, would let an
 * empty backend win against a real review.
 */
export function readLocalMark(store: MarkStore | null = browserStore()): ReviewMark | null {
  if (store === null) return null;
  let raw: string | null;
  try {
    raw = store.getItem(REVIEWED_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw.trim() === "") return null;

  if (!raw.trim().startsWith("{")) {
    const at = new Date(raw).getTime();
    if (Number.isNaN(at)) return null;
    return { lastReviewedAt: raw, updatedAt: at, device: "unknown" };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const lastReviewedAt = record.lastReviewedAt;
    if (typeof lastReviewedAt !== "string" || Number.isNaN(new Date(lastReviewedAt).getTime())) {
      return null;
    }
    const updatedAt =
      typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : new Date(lastReviewedAt).getTime();
    return {
      lastReviewedAt,
      updatedAt,
      device: typeof record.device === "string" && record.device !== "" ? record.device : "unknown",
    };
  } catch {
    return null;
  }
}

export function writeLocalMark(mark: ReviewMark, store: MarkStore | null = browserStore()): void {
  if (store === null) return;
  try {
    store.setItem(REVIEWED_KEY, JSON.stringify(mark));
  } catch {
    // Private mode: the stamp lasts for this page load only, which is still
    // the correct behaviour for the session you are in.
  }
}

/**
 * A mark's window, or the default one.
 *
 * A first-run browser has no stamp, and defaulting to the epoch would open the
 * ritual with every PR ever merged. It defaults to one window back instead —
 * the same thing the second review of the day sees.
 */
export function windowFrom(mark: ReviewMark | null, now: Date = new Date()): string {
  if (mark !== null) return mark.lastReviewedAt;
  return new Date(now.getTime() - DEFAULT_WINDOW_MS).toISOString();
}

/** What this browser is, in a few characters, for `ReviewMark.device`. */
export function describeDevice(userAgent: string | null | undefined): string {
  if (typeof userAgent !== "string" || userAgent === "") return "unknown";
  if (/iPhone|iPod/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Linux/.test(userAgent)) return "Linux";
  return "browser";
}

export interface Reconciled {
  /** The mark to believe, or `null` when neither side has one. */
  mark: ReviewMark | null;
  /** Whether the local mark is ahead and the backend should be told. */
  push: boolean;
}

/**
 * Which of two marks is right, and whether the backend needs telling.
 *
 * Last write wins by `updatedAt`. A **tie keeps the remote**, and a tie pushes
 * nothing: equal clocks mean the same mark came back to us, and preferring the
 * local copy would make every page load a write.
 *
 * A local mark with no remote does push — that is the first load after turning
 * the backend on, and the marker you already had is the one you meant.
 */
export function reconcileMarks(
  local: ReviewMark | null,
  remote: ReviewMark | null,
): Reconciled {
  if (local === null) return { mark: remote, push: false };
  if (remote === null) return { mark: local, push: true };
  if (local.updatedAt > remote.updatedAt) return { mark: local, push: true };
  return { mark: remote, push: false };
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
