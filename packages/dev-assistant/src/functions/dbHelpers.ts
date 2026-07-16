/**
 * Plain (non-Convex-function) DB helpers shared by the bugs, actions, and
 * contributions modules. Ported from Togather's `devAssistant/bugs.ts`.
 */

import { canTransition, type BugStatus } from "../pipeline/statusMachine";
import type { DevAssistantRefs } from "./refs";

/**
 * Append a message to a contribution's conversation thread (`devBugMessages`).
 * `userId` is only meaningful for authorType === "user". Stores `imageUrls`
 * only when non-empty — keeps text-only messages clean.
 */
export async function insertThreadMessage(
  ctx: any,
  bugId: string,
  authorType: "user" | "assistant" | "system",
  body: string,
  userId?: string,
  imageUrls?: string[],
): Promise<string> {
  return await ctx.db.insert("devBugMessages", {
    bugId,
    authorType,
    userId,
    body,
    ...(imageUrls && imageUrls.length > 0 ? { imageUrls } : {}),
    createdAt: Date.now(),
  });
}

/**
 * Apply a validated status transition and persist it. Throws on an illegal
 * transition. When a bug lands on READY_FOR_IMPL we schedule the dispatch action
 * immediately (event-driven, no cron) so the routine fires the instant the bug
 * is marked ready. Staging-redo rounds need no flag: dispatchBug infers redo
 * mode from the row's persisted redoRounds counter.
 */
export async function applyStatusTransition(
  ctx: any,
  bug: any,
  newStatus: BugStatus,
  refs: DevAssistantRefs,
): Promise<void> {
  if (!canTransition(bug.status, newStatus)) {
    throw new Error(
      `Illegal bug status transition: ${bug.status} -> ${newStatus}`,
    );
  }
  if (newStatus === bug.status) return;

  await ctx.db.patch(bug._id, {
    status: newStatus,
    updatedAt: Date.now(),
    ...(newStatus === "MERGED" && !bug.shippedAt
      ? { shippedAt: Date.now() }
      : {}),
  });

  if (newStatus === "READY_FOR_IMPL") {
    await ctx.scheduler.runAfter(0, refs.actions.dispatchBug, {
      bugId: bug._id,
    });
  }
}
