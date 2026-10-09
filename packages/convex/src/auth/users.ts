/**
 * The `createOrUpdateUser` callback `createSupaAuth` hands `convexAuth`.
 *
 * A returning account keeps its user. A new account is linked to an existing
 * user with the same phone or email before anything is created, so one person
 * who signs in two ways is one user. Only when nobody matches is a user row
 * created — and that is the one place `admission.canCreateUser` is asked, so
 * an invite-only app can refuse a stranger without ever locking out somebody
 * who already has an account. It is also the one place `onUserCreated` runs,
 * so an app hears about each brand-new account exactly once.
 */
import type { AnyDataModel, GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import type { convexAuth } from "@convex-dev/auth/server";

import { assertMayCreateUser, type SupaAuthAdmission } from "./admission";

/** See `SupaAuthConfig.findUserByEmail`. */
export type SupaAuthFindUserByEmail = (
  ctx: GenericMutationCtx<AnyDataModel>,
  email: string,
) => Promise<GenericId<"users"> | null>;

/** See `SupaAuthConfig.onUserCreated`. */
export type SupaAuthUserCreated = (
  ctx: GenericMutationCtx<AnyDataModel>,
  created: { userId: GenericId<"users">; provider: string; email?: string; phone?: string },
) => Promise<void>;

type Handler = NonNullable<
  NonNullable<Parameters<typeof convexAuth>[0]["callbacks"]>["createOrUpdateUser"]
>;

export function userCallback(
  admission: SupaAuthAdmission | undefined,
  onUserCreated?: SupaAuthUserCreated,
  findUserByEmail?: SupaAuthFindUserByEmail,
): Handler {
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
        // Fill in a missing address, never replace one. A user may sign in
        // through several auth accounts (an app that lets one person keep a
        // work and a home email), and the address on the user row is the one
        // they chose for mail, not whichever they signed in with last.
        if (profile.phone && !existingUser.phone) updateData.phone = profile.phone;
        if (profile.email && !existingUser.email) updateData.email = profile.email;
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
      // The app's own answer first: an address it has attached to a user as
      // an extra sign-in email is that user, whatever the user row says.
      const attached = findUserByEmail === undefined ? null : await findUserByEmail(ctx, email);
      if (attached !== null) {
        await ctx.db.patch(attached, { emailVerificationTime: Date.now() });
        return attached;
      }
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
    // Same transaction as the insert: a hook that throws undoes the account,
    // and anything it writes or schedules lands only if the account does.
    if (onUserCreated !== undefined) {
      await onUserCreated(ctx, {
        userId: userId as GenericId<"users">,
        provider: provider.id,
        ...(typeof profile.email === "string" ? { email: profile.email } : {}),
        ...(typeof profile.phone === "string" ? { phone: profile.phone } : {}),
      });
    }
    return userId as GenericId<"users">;
  }

  return createOrUpdateUser;
}
