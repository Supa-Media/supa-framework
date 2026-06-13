/**
 * Server-side Auth Helpers
 *
 * Convenience functions for requiring/checking authentication in Convex
 * queries, mutations, and actions. Built on top of @convex-dev/auth.
 *
 * Usage:
 * ```ts
 * import { requireAuth, requireAuthId, getOptionalAuth } from "@supa-media/convex/auth";
 *
 * export const myQuery = query({
 *   handler: async (ctx) => {
 *     const user = await requireAuth(ctx);
 *     // user is guaranteed to exist
 *   },
 * });
 * ```
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

/**
 * Generic context type that works with Convex query, mutation, and action contexts.
 * We use a minimal interface so consumers don't need to import generated types.
 */
interface AuthContext {
  db: {
    get: (id: any) => Promise<any>;
  };
  auth: {
    getUserIdentity: () => Promise<any>;
  };
}

/**
 * Require authentication. Throws if the user is not authenticated.
 * Returns the full user document from the users table.
 */
export async function requireAuth<TCtx extends AuthContext>(
  ctx: TCtx,
): Promise<Record<string, any>> {
  const userId = await getAuthUserId(ctx as any);
  if (userId === null) {
    throw new ConvexError({
      code: "NOT_AUTHENTICATED",
      message: "Not authenticated",
    });
  }
  const user = await ctx.db.get(userId);
  if (user === null) {
    throw new ConvexError({
      code: "USER_NOT_FOUND",
      message: "User record not found",
    });
  }
  return user;
}

/**
 * Require authentication and return just the user ID.
 * Throws if the user is not authenticated.
 */
export async function requireAuthId<TCtx extends AuthContext>(
  ctx: TCtx,
): Promise<string> {
  const userId = await getAuthUserId(ctx as any);
  if (userId === null) {
    throw new ConvexError({
      code: "NOT_AUTHENTICATED",
      message: "Not authenticated",
    });
  }
  return userId;
}

/**
 * Get the currently authenticated user, or null if not authenticated.
 * Does not throw — useful for endpoints that work with or without auth.
 */
export async function getOptionalAuth<TCtx extends AuthContext>(
  ctx: TCtx,
): Promise<Record<string, any> | null> {
  const userId = await getAuthUserId(ctx as any);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
}

/**
 * Get the current user ID, or null if not authenticated.
 * Does not throw — lighter weight than getOptionalAuth when you only need the ID.
 */
export async function getCurrentUserId<TCtx extends AuthContext>(
  ctx: TCtx,
): Promise<string | null> {
  return await getAuthUserId(ctx as any);
}
