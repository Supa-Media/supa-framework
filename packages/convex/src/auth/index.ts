export { createSupaAuth, MAGIC_LINK_PROVIDER_ID } from "./setup";
export type {
  SupaAuthConfig,
  SupaAuthMagicLinkConfig,
  SupaAuthResendConfig,
  SupaAuthTwilioConfig,
} from "./setup";
export {
  requireAuth,
  requireAuthId,
  getOptionalAuth,
  getCurrentUserId,
} from "./helpers";
