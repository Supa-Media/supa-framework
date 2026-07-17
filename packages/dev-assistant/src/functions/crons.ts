/**
 * Reconcile-cron registrar — the REQUIRED backstop for `/github/webhook`.
 *
 * `reconcileMergedPrs` (exported from `actions.ts`) is a faithful port of
 * Togather's polling backstop, but a Convex cron registration can't live
 * inside a raw-TS framework package the way the action itself can — `crons.ts`
 * is a per-deployment singleton the consumer owns. This helper is the wiring
 * seam: it builds the same `FunctionReference` the rest of the package uses
 * (via `functionsPath`) and registers it on the consumer's `Crons` object at
 * Togather's production cadence (`apps/convex/crons.ts`, every 15 minutes).
 *
 * This is NOT optional. It is the only path that reflects:
 *   (a) a maintainer merging the PR by hand on GitHub,
 *   (b) a merge of an item above its auto-merge severity cap,
 *   (c) any merge when webhook delivery is missing or mis-secreted.
 * Skip it and any of those three leaves the row stranded at READY_TO_MERGE
 * forever, with no `mergeCommitSha` for staging-deploy observation to
 * correlate against.
 *
 * Usage (`convex/crons.ts`):
 * ```ts
 * import { cronJobs } from "convex/server";
 * import { registerDevAssistantCrons } from "@supa-media/dev-assistant";
 * // Side-effect import: guarantees setDevAssistantConfig() has run so the
 * // holder's functionsPath is set before this module registers the cron.
 * import "./functions/devAssistant/config";
 *
 * const crons = cronJobs();
 * registerDevAssistantCrons(crons);
 * export default crons;
 * ```
 */

import { makeFunctionReference, type Crons } from "convex/server";
import { getDevAssistantConfig } from "../holder";

/** Cron identifier, matching Togather's production registration. */
export const RECONCILE_CRON_NAME = "dev-assistant-pr-merge-reconcile";

/** Cron schedule, matching Togather's production cadence (every 15 min). */
export const RECONCILE_CRON_SCHEDULE = "*/15 * * * *";

/**
 * Register the reconcile-backstop cron. Reads `functionsPath` from the holder —
 * the consumer's config module (which calls `setDevAssistantConfig`) MUST be
 * imported for its side effect before this runs (see the usage example above).
 */
export function registerDevAssistantCrons(crons: Crons): void {
  const { functionsPath } = getDevAssistantConfig();
  crons.cron(
    RECONCILE_CRON_NAME,
    RECONCILE_CRON_SCHEDULE,
    makeFunctionReference<"action">(
      `${functionsPath}/actions:reconcileMergedPrs`,
    ),
    {},
  );
}
