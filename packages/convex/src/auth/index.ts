export {
  createSupaAuth,
  MAGIC_LINK_PROVIDER_ID,
  NOT_ADMITTED_MESSAGE,
  TEST_EMAIL_PROVIDER_ID,
} from "./setup";
export type {
  SupaAuthAdmission,
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
