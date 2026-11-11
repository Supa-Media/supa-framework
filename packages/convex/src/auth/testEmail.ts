/**
 * Sign-in providers for named test accounts (the CUJ account, a reviewer).
 *
 * Each account gets a provider of its own that refuses every other address.
 *
 * ## Issued codes, not fixed ones
 *
 * With no `code`, the provider never mints anything anybody can know: a
 * sign-in started through it draws a fresh random code and mails nothing. The
 * app issues codes instead, out of band (a staff tool), by writing a
 * verification code row under this provider's id with an expiry of its own —
 * `ctx.runMutation(internal.auth.store, { args: { type:
 * "createVerificationCode", provider: <id>, email, code, expirationTime,
 * allowExtraProviders: false } })`. Such a code is single-use, expires, and is
 * rate-limited under the address like any other, which is what a security
 * assessment asks of every account (CASA 1.2.1 / 1.3.x). A fixed code that
 * works every time, for whoever read it, is the thing this replaces.
 *
 * Note that starting a sign-in through the provider replaces any issued code
 * for the account (`@convex-dev/auth` keeps one code per account), so a client
 * redeeming an issued code should go straight to the step that carries it, or
 * the app should make the start step a no-op for these providers.
 *
 * `code` is still accepted for local development and is never the default.
 */

import { Email } from "@convex-dev/auth/providers/Email";
import { generateOtpCode } from "./otpCode";

/** Provider id for an explicitly scoped production test account. */
export const TEST_EMAIL_PROVIDER_ID = "test-email";

export interface SupaAuthTestEmailConfig {
  /** The only email address allowed to use the fixed test code. */
  email: string;
  /**
   * A fixed verification code, for local development only. Omitted (the
   * default, and the only safe production setting), the provider mints a
   * random code nobody sees and the app issues codes itself. See above.
   */
  code?: string;
  /**
   * Provider id the client signs in with. Defaults to `TEST_EMAIL_PROVIDER_ID`.
   *
   * Needed only when an app has more than one fixed-code account, because
   * `@convex-dev/auth` mints a provider's code without knowing the address,
   * so each account needs a provider, and so an id, of its own. Must start
   * with `TEST_EMAIL_PROVIDER_ID`, which keeps it clear of the customer
   * `email` provider whose `authorize` it must never share.
   */
  id?: string;
}

/** Build the test account's provider separately so its security boundary is testable. */
export function createTestEmailOtp(config: SupaAuthTestEmailConfig) {
  const email = config.email.trim().toLowerCase();
  const code = config.code;
  const id = config.id ?? TEST_EMAIL_PROVIDER_ID;
  if (!/^test-email(-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`testEmail.id must be "${TEST_EMAIL_PROVIDER_ID}" or start with "${TEST_EMAIL_PROVIDER_ID}-"`);
  }
  if (code !== undefined && !/^\d{6}$/.test(code)) {
    throw new Error("testEmail.code must be exactly six digits");
  }
  if (email.length === 0) {
    throw new Error("testEmail.email must not be empty");
  }

  const provider = Email({
    maxAge: 10 * 60,
    generateVerificationToken: () => code ?? generateOtpCode(),
    sendVerificationRequest: async ({ identifier }) => {
      if (identifier.trim().toLowerCase() !== email) {
        throw new Error("This test sign-in provider is not available for that email.");
      }
    },
  });
  return {
    ...provider,
    id,
    authorize: async (params: Record<string, unknown>, account: { providerAccountId: string }) => {
      if (
        typeof params.email !== "string" ||
        params.email.trim().toLowerCase() !== email ||
        account.providerAccountId.trim().toLowerCase() !== email
      ) {
        throw new Error("This test sign-in provider is not available for that email.");
      }
    },
  };
}

/** One provider per configured account, refusing a repeated id or address. */
export function createTestEmailOtps(
  config: SupaAuthTestEmailConfig | SupaAuthTestEmailConfig[] | undefined,
) {
  const configs = config === undefined ? [] : Array.isArray(config) ? config : [config];
  const providers = configs.map(createTestEmailOtp);
  const ids = new Set(providers.map((provider) => provider.id));
  const emails = new Set(configs.map((entry) => entry.email.trim().toLowerCase()));
  if (ids.size !== providers.length) {
    throw new Error("testEmail entries must each have their own id");
  }
  if (emails.size !== configs.length) {
    throw new Error("testEmail entries must each have their own email");
  }
  return providers;
}
