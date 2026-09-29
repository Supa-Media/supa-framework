/**
 * Who may sign in at all: the hooks an invite-only or waitlisted app uses.
 *
 * Without `admission`, anybody who can read their inbox can make an account —
 * the default, and unchanged. With it, an app answers two questions:
 *
 *  - **May this address be mailed a code?** Asked before the email OTP
 *    provider sends anything. Refusing means no mail goes out and `signIn`
 *    throws, so a person who has not been let in never holds a code.
 *  - **May this person get a brand-new account?** Asked in
 *    `createOrUpdateUser`, only when no user exists yet. This is the backstop,
 *    and it is the one that covers every provider — the magic link, the
 *    fixed-code test accounts, a phone number — not only the email OTP.
 *    Returning users never reach it, so turning an app invite-only can never
 *    lock out an account that already exists.
 *
 * Both hooks fail closed: one that throws, or a send that arrives with no ctx
 * to ask with, refuses.
 *
 * The refusal is one fixed message, `NOT_ADMITTED_MESSAGE`. A client should
 * not rely on reading it — Convex redacts action errors in production — and
 * should instead ask the app whether an address is let in *before* calling
 * `signIn`, drawing its own "you're on the list" for the answer. These hooks
 * are what makes that answer binding rather than advisory.
 */
import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
} from "convex/server";

export interface SupaAuthAdmission {
  /**
   * Before a sign-in code is mailed. `email` is the address as the provider
   * received it; normalize it the same way the app stores addresses.
   */
  canReceiveEmailCode?: (
    ctx: GenericActionCtx<GenericDataModel>,
    email: string,
  ) => Promise<boolean>;
  /**
   * Before a user row is created for somebody with no account. `provider` is
   * the auth provider's id (`"email"`, `"magic-link"`, `"test-email"`, …).
   */
  canCreateUser?: (
    ctx: GenericMutationCtx<GenericDataModel>,
    who: { provider: string; email?: string; phone?: string },
  ) => Promise<boolean>;
}

export const NOT_ADMITTED_MESSAGE = "This address has not been let in yet.";

async function allowed(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return (await check()) === true;
  } catch (error) {
    console.error("[supa-auth] admission check failed, refusing:", error);
    return false;
  }
}

/** Throws unless `admission` lets `email` be mailed a code. */
export async function assertMayReceiveEmailCode(
  admission: SupaAuthAdmission | undefined,
  ctx: unknown,
  email: string,
): Promise<void> {
  const check = admission?.canReceiveEmailCode;
  if (check === undefined) return;
  const ok =
    ctx !== undefined &&
    ctx !== null &&
    (await allowed(() =>
      check(ctx as GenericActionCtx<GenericDataModel>, email),
    ));
  if (!ok) throw new Error(NOT_ADMITTED_MESSAGE);
}

/** Throws unless `admission` lets this person have a new account. */
export async function assertMayCreateUser(
  admission: SupaAuthAdmission | undefined,
  ctx: GenericMutationCtx<GenericDataModel>,
  who: { provider: string; email?: string; phone?: string },
): Promise<void> {
  const check = admission?.canCreateUser;
  if (check === undefined) return;
  if (!(await allowed(() => check(ctx, who)))) {
    throw new Error(NOT_ADMITTED_MESSAGE);
  }
}
