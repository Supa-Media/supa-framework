import type { FleetConfig } from "../fleet.config";
import type { FleetSnapshot, FleetWriter } from "../sources/types";

/** Every nav destination. `app:<repoKey>` is one per repo in the fleet. */
export type ViewId =
  | "review"
  | "inbox"
  | "copilot"
  | "now"
  | "queue"
  | "watchdog"
  | "gardeners"
  | "secrets"
  | "newapp"
  | `app:${string}`;

/**
 * How a view performs a write.
 *
 * One action at a time by construction: `busy` is a single key, not a set. The
 * dashboard's writes are label changes on shared issues, and two overlapping
 * ones would race for the same list — refusing the second is both simpler and
 * more honest than pretending they are independent.
 */
export interface Actions {
  /** Key of the write currently in flight, or `null`. */
  busy: string | null;
  /** Last write failure, cleared when the next one starts. */
  error: string | null;
  /**
   * One-line confirmation of the last write that succeeded, or `null`.
   *
   * A sentence, not the write's key: the key is `notify:owner/repo#12`, which is
   * a debugging aid rather than something to show a person. Callers that pass no
   * message leave this `null` because they render their own confirmation (the
   * Inbox paste box, the palette's own close).
   */
  done: string | null;
  /**
   * Perform a write, then refetch.
   *
   * `done` is the confirmation to show afterwards. Passing one is the norm: a
   * label write whose only visible effect is a row quietly changing after a
   * refresh is indistinguishable from a click that missed.
   */
  run(key: string, fn: (writer: FleetWriter) => Promise<void>, done?: string): void;
}

export interface Ctx {
  config: FleetConfig;
  snapshot: FleetSnapshot;
  actions: Actions;
  /** ISO-8601 lower bound of the current review window. */
  since: string;
  navigate(view: ViewId): void;
}
