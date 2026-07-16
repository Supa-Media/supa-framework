/**
 * Notifier seam — the injection point for every push / chat side effect the
 * pipeline produces.
 *
 * In Togather the pipeline pushed to the originator on some transitions AND, for
 * chat-originated bugs, posted a bot message into the chat thread (with
 * per-round `sourceKey` idempotency and `@mention`s). None of that is
 * generalizable — push channels and chat plumbing are app-specific — so the
 * package no longer branches on `channelId`. Instead it emits a typed event at
 * each notification point and calls `notifier.notify(ctx, event)`; the consumer
 * decides HOW to notify (push, chat message, e-mail, nothing). The default
 * notifier is a no-op, so a minimal consumer gets a silent-but-correct pipeline.
 *
 * Togather's migration re-implements its exact behavior inside `notify`: push
 * for dashboard items (`bug.source !== "chat"`), and for chat items post the bot
 * message keyed by `chatStatusUpdate`'s `sourceKey`.
 */

import type { BugStatus } from "./pipeline/statusMachine";

/**
 * The pipeline row, loosely typed (the Convex functions run untyped via the
 * `*Generic` builders). Consumers narrow the fields they added themselves.
 */
export type DevBugDoc = {
  _id: string;
  originatorUserId: string;
  title: string;
  status: BugStatus;
  kind?: "bug" | "feature";
  source?: "chat" | "dashboard";
  spec?: string;
  aiTitle?: string;
  prUrl?: string;
  verifyOnStaging?: boolean;
  redoRounds?: number;
  [key: string]: unknown;
};

export type DevAssistantEvent =
  /** Spec drafted and ready for the contributor to review (IN_REVIEW + spec). */
  | { type: "specReady"; bug: DevBugDoc }
  /** A spec revision landed without a status change. */
  | { type: "specRevised"; bug: DevBugDoc }
  /** Implementation started (READY_FOR_IMPL). `actorUserId` triggered it, if human. */
  | { type: "buildStarted"; bug: DevBugDoc; actorUserId?: string }
  /** A PR opened (genuine entry into CODE_REVIEW). */
  | { type: "prOpened"; bug: DevBugDoc }
  /** Review approved → READY_TO_MERGE. */
  | { type: "readyToMerge"; bug: DevBugDoc }
  /** The change merged. */
  | { type: "merged"; bug: DevBugDoc }
  /** The staging deploy actually went live (deploy observation). */
  | { type: "stagingLive"; bug: DevBugDoc }
  /** Code review still failing after the fix-round budget — needs a human. */
  | { type: "fixRoundsExhausted"; bug: DevBugDoc }
  /** Contributor confirmed the change works on staging. */
  | { type: "stagingVerified"; bug: DevBugDoc; actorUserId: string }
  /** Contributor rejected the staging check → redo round dispatched. */
  | { type: "stagingRedo"; bug: DevBugDoc; actorUserId: string }
  /**
   * A callback-applied status update, for consumers that mirror progress into a
   * chat thread (Togather's chat-originated bots). `sourceKey` is a per-round
   * idempotency key the consumer can use to dedupe re-delivered callbacks.
   */
  | {
      type: "chatStatusUpdate";
      bug: DevBugDoc;
      effectiveStatus: BugStatus;
      prUrl?: string;
      message: string;
      sourceKey: string;
    };

/** Minimal ctx shape passed through to the notifier (scheduler + runMutation). */
export interface NotifierCtx {
  scheduler: { runAfter: (delayMs: number, fn: any, args: any) => Promise<any> };
  runMutation?: (fn: any, args: any) => Promise<any>;
  runAction?: (fn: any, args: any) => Promise<any>;
  [key: string]: unknown;
}

export interface DevAssistantNotifier {
  notify(ctx: NotifierCtx, event: DevAssistantEvent): Promise<void> | void;
}

/** The default no-op notifier — a correct, silent pipeline. */
export const noopNotifier: DevAssistantNotifier = {
  notify() {
    /* no-op */
  },
};
