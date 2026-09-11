export {
  createSupaAuth,
  MAGIC_LINK_PROVIDER_ID,
  TEST_EMAIL_PROVIDER_ID,
} from "./setup";
export type {
  SupaAuthConfig,
  SupaAuthMagicLinkConfig,
  SupaAuthResendConfig,
  SupaAuthTestEmailConfig,
  SupaAuthTwilioConfig,
} from "./setup";
export {
  requireAuth,
  requireAuthId,
  getOptionalAuth,
  getCurrentUserId,
} from "./helpers";
