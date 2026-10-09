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
  SupaAuthUserCreated,
  SupaAuthFindUserByEmail,
} from "./setup";
export {
  checkTwilioVerification,
  sendTwilioVerification,
  twilioVerifyKeys,
} from "./twilioVerify";
export type { TwilioCheckResult, TwilioSendResult, TwilioVerifyKeys } from "./twilioVerify";
export {
  requireAuth,
  requireAuthId,
  getOptionalAuth,
  getCurrentUserId,
} from "./helpers";
