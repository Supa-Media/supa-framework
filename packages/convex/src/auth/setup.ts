/**
 * Supa Auth Setup
 *
 * Creates a pre-configured @convex-dev/auth setup with Phone (Twilio) and
 * Email (Resend) OTP providers. Supports dev bypass via DEV_OTP_BYPASS env var.
 *
 * Usage:
 * ```ts
 * // convex/auth.ts
 * import { createSupaAuth } from "@supa-media/convex/auth";
 *
 * export const { auth, signIn, signOut, store, isAuthenticated } = createSupaAuth({
 *   appName: "MyApp",
 *   resend: {
 *     fromAddress: "auth@myapp.com",
 *     emailSubject: (code) => `${code} is your MyApp code`,
 *   },
 *   twilio: {
 *     tokenBridgePath: "/api/internal/phone-token",
 *   },
 * });
 * ```
 */

import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { Phone } from "@convex-dev/auth/providers/Phone";
import type { GenericId } from "convex/values";

export interface SupaAuthResendConfig {
  /** The "from" address for OTP emails. */
  fromAddress: string;
  /** Function to generate the email subject line. */
  emailSubject?: (code: string) => string;
  /** Custom HTML renderer for OTP emails. Receives { code, email }. */
  renderHtml?: (params: { code: string; email: string }) => string;
}

export interface SupaAuthTwilioConfig {
  /** Path on the Convex site URL for the phone token bridge endpoint. */
  tokenBridgePath?: string;
}

/**
 * The provider id a magic-link code is minted under.
 *
 * Exported because minting is the caller's job, not this module's: an app
 * creates the code itself — `ctx.runMutation(internal.auth.store, { args: {
 * type: "createVerificationCode", provider: MAGIC_LINK_PROVIDER_ID, email,
 * code, expirationTime, allowExtraProviders: false } })` — puts it in a URL,
 * and mails it. Redemption needs nothing from the app: `@convex-dev/auth`'s
 * React provider reads a `code` query parameter on mount, calls `signIn` with
 * it, and strips it from the URL.
 *
 * It must not be `"email"`. Sharing the OTP provider's id would mean sharing
 * its `authorize`, which is the whole point of the separation below.
 */
export const MAGIC_LINK_PROVIDER_ID = "magic-link";

export interface SupaAuthMagicLinkConfig {
  /**
   * How long a link stays live, in seconds. Defaults to one hour.
   *
   * Keep it short. A code is typed from a screen somebody is looking at; a
   * link sits in a mailbox, gets forwarded, and is read by anything with
   * access to that mailbox later.
   */
  maxAge?: number;
  /**
   * Send the mail. Receives the same arguments `@convex-dev/auth` passes any
   * email provider, including the `url` the OTP provider throws away.
   *
   * Optional, and omitted is the normal case: an app that mints its own codes
   * (see `MAGIC_LINK_PROVIDER_ID`) has already sent its own mail, and this
   * provider is registered only so the code can be redeemed. It is called
   * only when something signs in *through* this provider by name.
   */
  sendVerificationRequest?: (params: {
    identifier: string;
    url: string;
    token: string;
  }) => Promise<void>;
}

export interface SupaAuthConfig {
  /** App name, used in default email templates. */
  appName?: string;
  /**
   * Which OTP methods to enable. Defaults to both `["email", "phone"]`.
   * Set to `["email"]` for an email-only app so no dormant phone provider
   * is registered.
   */
  methods?: Array<"email" | "phone">;
  /**
   * Register a second, link-only email provider alongside the OTP one.
   *
   * Off by default. Turn it on for an app that emails somebody a URL which
   * signs them in when they click it — an invitation, a "finish setting up"
   * nudge — rather than a code they type. See `SupaAuthMagicLinkConfig` and
   * `MAGIC_LINK_PROVIDER_ID` for what it does and does not change.
   */
  magicLink?: SupaAuthMagicLinkConfig;
  /** Resend email OTP configuration. */
  resend?: SupaAuthResendConfig;
  /** Twilio phone OTP configuration. */
  twilio?: SupaAuthTwilioConfig;
  /**
   * Production deployment identifier substring (e.g. "giddy-donkey-905").
   * When CONVEX_SITE_URL contains this string, DEV_OTP_BYPASS is ignored.
   */
  productionIdentifier?: string;
}

/** Default bypass OTP code for development. */
const DEV_BYPASS_CODE = "000000";

function normalizeConvexSiteUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  if (url.includes(".convex.site")) return url;
  return url.replace(".convex.cloud", ".convex.site");
}

/**
 * Generate a cryptographically secure 6-digit OTP code.
 * In dev mode (DEV_OTP_BYPASS=true), returns the bypass code instead.
 */
function createOtpGenerator(productionIdentifier?: string) {
  return function generateVerificationToken(): string {
    if (process.env.DEV_OTP_BYPASS === "true") {
      const siteUrl = process.env.CONVEX_SITE_URL ?? "";
      if (productionIdentifier && siteUrl.includes(productionIdentifier)) {
        console.error(
          "DEV_OTP_BYPASS is enabled on production — ignoring. Remove this env var from the production deployment.",
        );
      } else {
        return DEV_BYPASS_CODE;
      }
    }
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return (100000 + (array[0] % 900000)).toString();
  };
}

function createEmailOtp(config: SupaAuthConfig) {
  const resendConfig = config.resend;

  return Email({
    maxAge: 10 * 60, // 10 minutes
    generateVerificationToken: createOtpGenerator(config.productionIdentifier),
    sendVerificationRequest: async ({ identifier: email, token }) => {
      // Dynamic import of resend — only loaded when RESEND_API_KEY is set
      const apiKey = process.env.RESEND_API_KEY;

      if (!apiKey) {
        console.log("=== OTP CODE (no RESEND_API_KEY) ===");
        console.log(`To: ${email}`);
        console.log(`Code: ${token}`);
        console.log("=====================================");
        return;
      }

      const fromAddress = resendConfig?.fromAddress ?? "noreply@example.com";
      const subject = resendConfig?.emailSubject
        ? resendConfig.emailSubject(token)
        : `${token} is your ${config.appName ?? "Supa"} code`;

      const html = resendConfig?.renderHtml
        ? resendConfig.renderHtml({ code: token, email })
        : `<p>Your verification code is: <strong>${token}</strong></p><p>This code expires in 10 minutes.</p>`;

      // Use fetch to call Resend API directly to avoid hard dependency
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: email,
          subject,
          html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Resend email send error:", errorText);
        throw new Error("Failed to send verification email. Please try again.");
      }
    },
  });
}

/**
 * The link-only email provider.
 *
 * ## Why this is a second provider and not a flag on the first
 *
 * `Email()` from `@convex-dev/auth` hardcodes an `authorize` that refuses any
 * verification unless `params.email` is supplied and matches the account. That
 * is exactly right for a 6-digit code and exactly wrong for a link, where the
 * whole point is that the URL carries everything.
 *
 * Its own docstring says you can pass `authorize: undefined` to get "magic link
 * behavior". **In 0.0.90 you cannot** — the factory builds its return value
 * field by field and never spreads `config`, so `config.authorize` is dropped
 * on the floor. The only way to clear it is to spread the built provider and
 * override the key afterwards, which is what happens below.
 *
 * Doing that to the OTP provider instead — one line, and the obvious
 * "simplification" of this file — would be a serious regression, because
 * `authorize` is not the only thing keyed on the email:
 *
 *   - `verifyCodeAndSignInImpl` derives its rate-limit key from
 *     `params.email ?? params.phone`. With no email in params **there is no
 *     rate limiting at all.**
 *   - The code itself is then the only secret, and the OTP provider's code is
 *     six digits — a space of one million, unthrottled, checked against every
 *     code in flight for every user at once rather than one account's.
 *
 * So the OTP provider keeps its email check, and links get their own provider
 * whose tokens must carry their own entropy. `@convex-dev/auth` resolves which
 * `authorize` to run from the provider recorded **on the verification code
 * row**, not from what the caller claims, so the two cannot be confused: a
 * six-digit OTP row still demands its email even when redeemed by a client
 * that sent no provider at all.
 *
 * ## What the caller owes
 *
 * A high-entropy token. Nothing here can check that — the app mints the code —
 * so it is stated rather than enforced: 32 random bytes or more. Anything
 * guessable is now guessable without a rate limit and without knowing whose
 * mailbox it was sent to.
 *
 * ## This provider is publicly reachable, and that is survivable
 *
 * `api.auth.signIn` is public, so anybody can call
 * `signIn(MAGIC_LINK_PROVIDER_ID, { email })` for an address they do not own.
 * Two things make that a nuisance rather than a hole, and both are worth
 * knowing before anybody "hardens" it:
 *
 *  - **The code that gets minted is strong.** No `generateVerificationToken`
 *    is passed, so `@convex-dev/auth` falls back to
 *    `generateRandomString(32, <62-char alphabet>)` — around 190 bits. That
 *    matters more here than for the OTP provider, because this is the provider
 *    with no email check and no rate limit. (Passing a weak generator would not
 *    help an attacker either: the factory ignores it, like everything else in
 *    its config. It would help a careless *caller*, which is why the paragraph
 *    above exists.)
 *  - **Nothing is delivered to the attacker.** With no
 *    `sendVerificationRequest` configured the warning below fires and no mail
 *    goes out; with one configured, the mail goes to the address that was named,
 *    not to whoever asked. Either way the code lands somewhere the attacker
 *    cannot read.
 *
 * What they can do is mint a code for somebody else's address, which deletes
 * that account's pending code — a denial of service on a link already in
 * flight. That is not new: `signIn("email", { email })` has always been able to
 * invalidate a pending OTP the same way.
 */
function createMagicLink(config: SupaAuthConfig) {
  const magicLink = config.magicLink ?? {};

  return {
    ...Email({
      maxAge: magicLink.maxAge ?? 60 * 60,
      sendVerificationRequest: async ({ identifier, url, token }) => {
        if (magicLink.sendVerificationRequest !== undefined) {
          await magicLink.sendVerificationRequest({ identifier, url, token });
          return;
        }
        // Reached only if something signs in through this provider by name.
        // An app that mints its own codes has already sent its own mail; the
        // provider exists so that code can be redeemed. Saying so beats
        // silently succeeding at having sent nothing.
        console.warn(
          `[supa-auth] A sign-in was requested through the "${MAGIC_LINK_PROVIDER_ID}" ` +
            "provider, which has no sendVerificationRequest configured, so no mail was " +
            "sent. Pass magicLink.sendVerificationRequest, or mint the code yourself.",
        );
      },
    }),
    // Two overrides the factory ignores, for the same reason: it builds its
    // result field by field and never spreads `config`, so BOTH `id` and
    // `authorize` are hardcoded and anything passed in is dropped.
    //
    // `id` matters as much as `authorize` here. Left alone, this provider is
    // also called `"email"` — two entries with one id, so
    // `getProviderOrThrow` cannot tell them apart, and whichever it resolves
    // decides whether a six-digit OTP still needs its address. The separation
    // this whole function exists for would silently be no separation at all.
    id: MAGIC_LINK_PROVIDER_ID,
    // Without this the link is inert; with it on the *wrong* provider a
    // six-digit code becomes an unthrottled global secret.
    authorize: undefined,
  };
}

function createPhoneOtp(config: SupaAuthConfig) {
  const bridgePath =
    config.twilio?.tokenBridgePath ?? "/api/internal/phone-token";

  return Phone({
    maxAge: 10 * 60, // 10 minutes
    sendVerificationRequest: async ({ identifier: phone, token }) => {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
      const siteUrl = normalizeConvexSiteUrl(process.env.CONVEX_SITE_URL);
      const bridgeSecret = process.env.PHONE_TOKEN_BRIDGE_SECRET;

      if (!siteUrl || !bridgeSecret) {
        console.log("=== SMS OTP (bridge not configured) ===");
        console.log(`To: ${phone}`);
        console.log(`Auth Token: ${token}`);
        console.log("Use this token directly as the code in signIn()");
        console.log("=========================================");
        return;
      }

      // 1. Store the @convex-dev/auth token via HTTP bridge
      const storeResponse = await fetch(`${siteUrl}${bridgePath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bridgeSecret}`,
        },
        body: JSON.stringify({
          phone,
          token,
          expiresAt: Date.now() + 10 * 60 * 1000,
        }),
      });

      if (!storeResponse.ok) {
        console.error(
          "Failed to store phone auth token:",
          await storeResponse.text(),
        );
        throw new Error("Unable to initiate verification. Please try again.");
      }

      // 2. Send SMS via Twilio Verify
      if (!accountSid || !authToken || !verifyServiceSid) {
        console.log("=== SMS OTP (Twilio not configured) ===");
        console.log(`To: ${phone}`);
        console.log("Token stored. Use DEV_BYPASS_CODE to verify.");
        console.log("=========================================");
        return;
      }

      const response = await fetch(
        `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: phone,
            Channel: "sms",
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: { code?: number; message?: string };
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }

        console.error("Twilio Verify send error:", {
          status: response.status,
          errorCode: errorData?.code,
          errorMessage: errorData?.message,
          phone,
        });

        throw new Error(
          errorData?.message?.includes("Invalid phone number")
            ? "Invalid phone number. Please check and try again."
            : "Failed to send verification code. Please try again.",
        );
      }
    },
  });
}

/**
 * Create a fully configured Supa auth setup with Phone + Email OTP.
 *
 * Returns the same exports as `convexAuth()`: auth, signIn, signOut, store, isAuthenticated.
 */
export function createSupaAuth(config: SupaAuthConfig = {}) {
  const methods = config.methods ?? ["email", "phone"];
  const providers = [
    ...(methods.includes("email") ? [createEmailOtp(config)] : []),
    // Additive, and gated on the email method: a link signs somebody into an
    // email account, so registering it for an app that does not do email OTP
    // would be registering a way in that app never asked for.
    ...(methods.includes("email") && config.magicLink !== undefined
      ? [createMagicLink(config)]
      : []),
    ...(methods.includes("phone") ? [createPhoneOtp(config)] : []),
  ];

  return convexAuth({
    providers,
    callbacks: {
      async createOrUpdateUser(ctx, { existingUserId, type, profile }) {
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
      },
    },
  });
}
