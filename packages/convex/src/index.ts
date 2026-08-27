/**
 * @supa-media/convex
 *
 * Backend package for the Supa framework — OTP auth, schema helpers,
 * and backend utilities for Convex.
 */

// Auth
export {
  createSupaAuth,
  MAGIC_LINK_PROVIDER_ID,
  requireAuth,
  requireAuthId,
  getOptionalAuth,
  getCurrentUserId,
} from "./auth";
export type {
  SupaAuthConfig,
  SupaAuthMagicLinkConfig,
  SupaAuthResendConfig,
  SupaAuthTwilioConfig,
} from "./auth";

// Schema
export {
  supaAuthTables,
  supaTenantTables,
  supaTenantScope,
  supaNotificationTables,
  supaChatTables,
  supaPaymentTables,
} from "./schema";
export type { TenantTableConfig, SupaTenantScope, TenantScopeConfig } from "./schema";

// Lib
export {
  checkRateLimit,
  supaRateLimitTable,
  isValidPhone,
  isValidEmail,
  normalizePhone,
  normalizeEmail,
  CronSchedules,
  Delay,
} from "./lib";

// Notifications
export {
  registerPushToken,
  cleanupExpiredTokens,
  enqueueNotification,
  sendPushNotification,
  sendNotificationToUser,
  processNotificationQueue,
} from "./notifications";
export type {
  NotificationPayload,
  ExpoPushMessage,
  ExpoPushTicket,
} from "./notifications";

// Payments
export {
  getOrCreateCustomer,
  createCheckoutSession,
  getSubscriptionStatus,
  handleStripeWebhook,
  verifyStripeSignature,
} from "./payments";
export type {
  CheckoutSessionParams,
  SubscriptionStatus,
} from "./payments";
