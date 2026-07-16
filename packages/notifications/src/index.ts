/**
 * @supa-media/notifications — Push notification infrastructure for Supa apps.
 *
 * @example
 * ```tsx
 * import { NotificationProvider } from "@supa-media/notifications";
 * import { useNotifications, useNotificationPermission, usePushToken } from "@supa-media/notifications/hooks";
 *
 * // In your root layout:
 * <NotificationProvider
 *   onNotificationTap={(event) => router.push(event.deepLink ?? "/")}
 *   requestPermissionDelay={5000}
 *   onTokenRegistered={(token, platform) => {
 *     // Register token with your Convex backend
 *     registerTokenMutation({ token, platform });
 *   }}
 * >
 *   {children}
 * </NotificationProvider>
 * ```
 */

// Provider
export { NotificationProvider } from "./providers/index.js";
export type { NotificationProviderProps } from "./providers/index.js";

// Hooks
export {
  useNotifications,
  useNotificationPermission,
  usePushToken,
} from "./hooks/index.js";

// Handlers
export { registerBackgroundHandler, resolveDeepLink } from "./handlers/index.js";

// Config
export { setupAndroidChannels, DEFAULT_ANDROID_CHANNELS } from "./config/index.js";

// Types
export type {
  NotificationPayload,
  NotificationData,
  NotificationTapEvent,
  NotificationProviderConfig,
  PermissionStatus,
  UseNotificationsResult,
  UseNotificationPermissionResult,
  UsePushTokenResult,
  AndroidNotificationChannel,
} from "./types/index.js";
