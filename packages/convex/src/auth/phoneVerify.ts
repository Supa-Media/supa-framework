/**
 * Sign in with a phone whose code Twilio Verify holds.
 *
 * An app texts the code itself (`sendTwilioVerification`), deciding first who
 * may be texted at all, then the client calls
 * `signIn(PHONE_VERIFY_PROVIDER_ID, { phone, code })`. This provider asks
 * Twilio whether that code is approved for that phone, and only then asks the
 * app which user holds the phone. Nothing secret is stored: Twilio keeps the
 * code, and the app keeps only which phone is whose.
 *
 * ## It signs people in, it never makes them
 *
 * `findUserByPhone` answering `null` refuses the sign-in. A new person comes
 * in another way (an email code, an invitation link) and adds the phone once
 * signed in. That keeps the provider out of `createOrUpdateUser`, and out of
 * `admission`, entirely: there is no row it could create.
 *
 * ## Guessing a code
 *
 * `@convex-dev/auth` does not rate-limit a credentials provider, so the limits
 * are Twilio's — five checks per texted code, and a code lives ten minutes —
 * and the app's own `mayCheck`, asked before every check. It fails closed: a
 * hook that throws refuses. Only `approved` from Twilio signs anybody in.
 */

import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import type { AnyDataModel, GenericActionCtx } from "convex/server";
import type { GenericId } from "convex/values";

import { checkTwilioVerification, twilioVerifyKeys, type TwilioCheckResult } from "./twilioVerify";

/** Provider id the client signs in with. */
export const PHONE_VERIFY_PROVIDER_ID = "phone-verify";

/** E.164: a plus, a non-zero country digit, 7 to 15 digits in all. */
const E164 = /^\+[1-9]\d{6,14}$/;

export interface SupaAuthPhoneVerifyConfig {
  /**
   * The user who holds `phone` (E.164), or `null`. Only return a user the
   * phone was confirmed for: whoever holds that phone signs in as them.
   */
  findUserByPhone: (ctx: GenericActionCtx<AnyDataModel>, phone: string) => Promise<GenericId<"users"> | null>;
  /** Spend one check for `phone`; `false` refuses before Twilio is asked. */
  mayCheck?: (ctx: GenericActionCtx<AnyDataModel>, phone: string) => Promise<boolean>;
  /**
   * Whether `code` is the one texted to `phone`. Twilio Verify by default; an
   * app that texts its own codes (`sendTwilioSms`) answers from its records,
   * which is why it gets the action context.
   */
  check?: (phone: string, code: string, ctx: GenericActionCtx<AnyDataModel>) => Promise<TwilioCheckResult>;
}

async function twilioCheck(phone: string, code: string): Promise<TwilioCheckResult> {
  const keys = twilioVerifyKeys();
  if (keys === null) return "failed";
  return await checkTwilioVerification(keys, phone, code);
}

/** The `authorize` step, on its own so its boundary is testable without a deployment. */
export function phoneVerifyAuthorize(config: SupaAuthPhoneVerifyConfig) {
  const check = config.check ?? twilioCheck;
  return async (
    credentials: Partial<Record<string, unknown>>,
    ctx: GenericActionCtx<AnyDataModel>,
  ): Promise<{ userId: GenericId<"users"> } | null> => {
    const phone = typeof credentials.phone === "string" ? credentials.phone.trim() : "";
    const code = typeof credentials.code === "string" ? credentials.code.replace(/\s/g, "") : "";
    if (!E164.test(phone) || !/^\d{4,10}$/.test(code)) return null;
    if (config.mayCheck !== undefined) {
      let ok = false;
      try {
        ok = (await config.mayCheck(ctx, phone)) === true;
      } catch (error) {
        console.error("[supa-auth] phone check limit failed, refusing:", error);
      }
      if (!ok) return null;
    }
    if ((await check(phone, code, ctx)) !== "approved") return null;
    const userId = await config.findUserByPhone(ctx, phone);
    return userId === null ? null : { userId };
  };
}

export function createPhoneVerifySignIn(config: SupaAuthPhoneVerifyConfig) {
  return ConvexCredentials({
    id: PHONE_VERIFY_PROVIDER_ID,
    authorize: phoneVerifyAuthorize(config) as never,
  });
}
