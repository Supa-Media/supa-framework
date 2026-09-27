/**
 * Fixed-code sign-in for named test accounts (the CUJ account, a reviewer).
 *
 * Each account gets a provider of its own that refuses every other address,
 * which is what makes a fixed code safe to register in production.
 */

import { Email } from "@convex-dev/auth/providers/Email";

/** The code a test account uses when its config names none. */
const DEFAULT_TEST_CODE = "000000";

/** Provider id for an explicitly scoped production test account. */
export const TEST_EMAIL_PROVIDER_ID = "test-email";

export interface SupaAuthTestEmailConfig {
  /** The only email address allowed to use the fixed test code. */
  email: string;
  /** Fixed verification code. Defaults to `000000`. */
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

/** Build the fixed-code provider separately so its security boundary is testable. */
export function createTestEmailOtp(config: SupaAuthTestEmailConfig) {
  const email = config.email.trim().toLowerCase();
  const code = config.code ?? DEFAULT_TEST_CODE;
  const id = config.id ?? TEST_EMAIL_PROVIDER_ID;
  if (!/^test-email(-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`testEmail.id must be "${TEST_EMAIL_PROVIDER_ID}" or start with "${TEST_EMAIL_PROVIDER_ID}-"`);
  }
  if (!/^\d{6}$/.test(code)) {
    throw new Error("testEmail.code must be exactly six digits");
  }
  if (email.length === 0) {
    throw new Error("testEmail.email must not be empty");
  }

  const provider = Email({
    maxAge: 10 * 60,
    generateVerificationToken: () => code,
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

/** One fixed-code provider per configured account, refusing a repeated id or address. */
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
