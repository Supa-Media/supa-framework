/**
 * Sign-in providers an app checks entirely itself.
 *
 * Each is a `ConvexCredentials` provider with an id of the app's choosing and
 * an `authorize` the app writes: it is handed what the client sent and the
 * action context, and answers the user to sign in, or `null`. An app uses one
 * for a way in the built-in providers do not cover, such as a password staff
 * set for a single review account.
 *
 * `@convex-dev/auth` does not rate-limit a credentials provider, and it never
 * runs `createOrUpdateUser` for one, so the app's `authorize` owns both: the
 * guess limit, and naming only a user that already exists. The wrapper here
 * fails closed: an `authorize` that throws, or answers anything but
 * `{ userId }`, signs nobody in.
 */

import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import type { AnyDataModel, GenericActionCtx } from "convex/server";
import type { GenericId } from "convex/values";

export interface SupaAuthCredentialsConfig {
  /** Provider id the client signs in with: `signIn(id, { ...credentials })`. */
  id: string;
  /** The user these credentials sign in, or `null` to refuse. */
  authorize: (
    credentials: Partial<Record<string, unknown>>,
    ctx: GenericActionCtx<AnyDataModel>,
  ) => Promise<{ userId: GenericId<"users"> } | null>;
}

/** The `authorize` step with the fail-closed wrapper, on its own so it is testable without a deployment. */
export function credentialsAuthorize(config: SupaAuthCredentialsConfig) {
  return async (
    credentials: Partial<Record<string, unknown>>,
    ctx: GenericActionCtx<AnyDataModel>,
  ): Promise<{ userId: GenericId<"users"> } | null> => {
    try {
      const answer = await config.authorize(credentials, ctx);
      if (answer === null || typeof answer !== "object") return null;
      return typeof answer.userId === "string" && answer.userId.length > 0 ? { userId: answer.userId } : null;
    } catch (error) {
      console.error(`[supa-auth] ${config.id} authorize failed, refusing:`, error);
      return null;
    }
  };
}

export function createCredentialsSignIns(configs: SupaAuthCredentialsConfig[] | undefined) {
  if (configs === undefined) return [];
  const ids = new Set(configs.map((config) => config.id));
  if (ids.size !== configs.length) throw new Error("[supa-auth] credentials provider ids must be unique");
  return configs.map((config) =>
    ConvexCredentials({ id: config.id, authorize: credentialsAuthorize(config) as never }),
  );
}
