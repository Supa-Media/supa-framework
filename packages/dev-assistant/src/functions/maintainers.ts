/**
 * Maintainer helpers owned by the package. Role grant/revoke and the
 * maintainer-list UI stay in the CONSUMER's app (its role system is
 * app-specific — see the role-gate seam in config), so the only function the
 * package needs here is the auto-merge cap lookup its auto-merge action calls.
 *
 * Ported from Togather's `devAssistant/maintainers.ts` (`getAutoMergeCapForUser`).
 */

import { internalQueryGeneric } from "convex/server";
import { v } from "convex/values";
import type { ResolvedDevAssistantConfig } from "../config";
import type { AutoMergeSeverity } from "../pipeline/severity";

export function makeMaintainersFunctions(cfg: ResolvedDevAssistantConfig) {
  /**
   * The effective auto-merge severity cap for a user (default when unset).
   * Called by the auto-merge action, which runs outside a DB context. Reads the
   * OPTIONAL `users.autoMergeMaxSeverity` field.
   */
  const getAutoMergeCapForUser = internalQueryGeneric({
    args: { userId: v.id("users") },
    handler: async (ctx: any, args): Promise<AutoMergeSeverity> => {
      const user = await ctx.db.get(args.userId);
      return (user?.autoMergeMaxSeverity ??
        cfg.defaultAutoMergeMaxSeverity) as AutoMergeSeverity;
    },
  });

  return { getAutoMergeCapForUser };
}
