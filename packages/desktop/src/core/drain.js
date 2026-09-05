/**
 * One pass of the queue.
 *
 * Separated from the reducer and from the HTTP client so that the thing with
 * the loop in it has no rules in it: `outbox.next` decides what goes next,
 * `postEntry` performs it, `outbox.apply` records what happened, and this is
 * the three of them in a `while`.
 *
 * `maxRequests` bounds one pass so that a full queue on a returning connection
 * does not fire two hundred requests in a burst; the next pass picks up the
 * rest. It also guarantees termination: `apply` either removes the entry or
 * pushes its `nextAttemptAt` past `now`, but a caller-supplied clock that never
 * advances would otherwise re-offer the same head forever.
 */

import { postEntry } from "./client.js";

/**
 * @param {{ version: number, entries: any[] }} queue
 * @param {ReturnType<import("./outbox.js").defineOutbox>} outbox
 * @param {Parameters<typeof postEntry>[0]} config
 * @param {() => number} now
 * @param {number} [maxRequests]
 * @returns {Promise<{ outbox: any, sent: number, failed: number, parked: number }>}
 */
export async function drainOnce(queue, outbox, config, now, maxRequests = 25) {
  let current = queue;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < maxRequests; i += 1) {
    const entry = outbox.next(current, now());
    if (!entry) break;
    const result = await postEntry(config, entry);
    current = outbox.apply(current, entry.id, result, now());
    if (result.ok) sent += 1;
    else failed += 1;
  }

  return {
    outbox: current,
    sent,
    failed,
    parked: current.entries.filter((entry) => entry.state === "parked").length,
  };
}
