/**
 * The `createOrUpdateUser` callback `createSupaAuth` hands `convexAuth`.
 *
 * A returning account keeps its user. A new account is linked to an existing
 * user with the same phone or email before anything is created, so one person
 * who signs in two ways is one user. Only when nobody matches is a user row
 * created — and that is the one place `admission.canCreateUser` is asked, so
 * an invite-only app can refuse a stranger without ever locking out somebody
 * who already has an account.
 */
import type { GenericId } from "convex/values";
import type { convexAuth } from "@convex-dev/auth/server";

import { assertMayCreateUser, type SupaAuthAdmission } from "./admission";

type Handler = NonNullable<
  NonNullable<Parameters<typeof convexAuth>[0]["callbacks"]>["createOrUpdateUser"]
>;

export function userCallback(admission: SupaAuthAdmission | undefined): Handler {
  async function createOrUpdateUser(
    ctx: Parameters<Handler>[0],
    { existingUserId, type, provider, profile }: Parameters<Handler>[1],
  ): Promise<GenericId<"users">> {
    // Returning user — auth account already exists
    if (existingUserId !== null) {
      const existingUser = await ctx.db.get(existingUserId);
      if (existingUser) {
        const updateData: Record<string, unknown> = {};
        if (type === "phone" || type === "verification") {
          updateData.phoneVerificationTime = Date.now();
        }
        if (type === "email" || type === "verification") {
          updateData.emailVerificationTime = Date.now();
        }
        if (profile.phone) updateData.phone = profile.phone;
        if (profile.email) updateData.email = profile.email;
        if (profile.name) updateData.name = profile.name;

        if (Object.keys(updateData).length > 0) {
          await ctx.db.patch(existingUserId, updateData);
        }
        return existingUserId;
      }
    }

    // New auth account — try to link to existing user by phone
    if (type === "phone" && typeof profile.phone === "string") {
      const phone = profile.phone;
      const existingUser = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("phone"), phone))
        .first();

      if (existingUser) {
        await ctx.db.patch(existingUser._id, {
          phoneVerificationTime: Date.now(),
        });
        return existingUser._id;
      }
    }

    // New auth account — try to link to existing user by email
    if (type === "email" && typeof profile.email === "string") {
      const email = profile.email;
      const existingUser = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("email"), email))
        .first();

      if (existingUser) {
        await ctx.db.patch(existingUser._id, {
          emailVerificationTime: Date.now(),
        });
        return existingUser._id;
      }
    }

    // No existing user. Ask the app first: this is the backstop that holds
    // for every provider, not only the email OTP. See `admission.ts`.
    await assertMayCreateUser(admission, ctx, {
      provider: provider.id,
      ...(typeof profile.email === "string" ? { email: profile.email } : {}),
      ...(typeof profile.phone === "string" ? { phone: profile.phone } : {}),
    });

    // No existing user — create a new one
    const userData: Record<string, unknown> = {};
    if (profile.email) userData.email = profile.email;
    if (profile.phone) userData.phone = profile.phone;
    if (profile.name) userData.name = profile.name;
    if (profile.image) userData.image = profile.image;
    if (profile.emailVerified || type === "email") {
      userData.emailVerificationTime = Date.now();
    }
    if (profile.phoneVerified || type === "phone") {
      userData.phoneVerificationTime = Date.now();
    }
    userData.isActive = true;
    userData.createdAt = Date.now();

    const userId = await ctx.db.insert(
      "users",
      userData as Record<string, unknown> & {
        email?: string;
        phone?: string;
      },
    );
    return userId as GenericId<"users">;
  }

  return createOrUpdateUser;
}
