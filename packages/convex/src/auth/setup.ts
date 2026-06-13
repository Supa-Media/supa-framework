/**
 * Supa Auth Setup
 *
 * Creates a pre-configured @convex-dev/auth setup with Phone (Twilio) and
 * Email (Resend) OTP providers. Supports dev bypass via DEV_OTP_BYPASS env var.
 *
 * Usage:
 * ```ts
 * // convex/auth.ts
 * import { createSupaAuth } from "@supa/convex/auth";
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

export interface SupaAuthConfig {
  /** App name, used in default email templates. */
  appName?: string;
  /**
   * Which OTP methods to enable. Defaults to both `["email", "phone"]`.
   * Set to `["email"]` for an email-only app so no dormant phone provider
   * is registered.
   */
  methods?: Array<"email" | "phone">;
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
