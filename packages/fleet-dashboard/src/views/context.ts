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
  /** Last write that succeeded, for a one-line confirmation. */
  done: string | null;
  run(key: string, fn: (writer: FleetWriter) => Promise<void>): void;
}

export interface Ctx {
  config: FleetConfig;
  snapshot: FleetSnapshot;
  actions: Actions;
  /** ISO-8601 lower bound of the current review window. */
  since: string;
  navigate(view: ViewId): void;
}
