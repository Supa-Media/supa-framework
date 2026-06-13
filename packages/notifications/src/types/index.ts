/**
 * Type definitions for @supa-media/notifications
 */

// =============================================================================
// Notification Payload
// =============================================================================

/** Payload structure for push notifications */
export interface NotificationPayload {
  /** Notification title */
  title: string;
  /** Notification body text */
  body: string;
  /** Optional image URL to display */
  image?: string;
  /** Deep link URL for navigation on tap */
  deepLink?: string;
  /** Arbitrary data to include with the notification */
  data?: Record<string, string>;
  /** Badge count to set on the app icon */
  badge?: number;
  /** Sound to play (use "default" for system sound) */
  sound?: string;
  /** Android notification channel ID */
  channelId?: string;
}

// =============================================================================
// Permission
// =============================================================================

/** Permission status for push notifications */
export type PermissionStatus = "granted" | "denied" | "undetermined";

// =============================================================================
// Notification Data
// =============================================================================

/** Parsed notification data from a received notification */
export interface NotificationData {
  /** Unique notification identifier */
  id: string;
  /** Notification title */
  title: string;
  /** Notification body text */
  body: string;
  /** Arbitrary data attached to the notification */
  data: Record<string, unknown>;
}

// =============================================================================
// Provider Config
// =============================================================================

/** Configuration options for NotificationProvider */
export interface NotificationProviderConfig {
  /**
   * Callback when user taps a notification.
   * Receives the deep link path (if present) or the full notification data.
   * Use this to navigate via Expo Router.
   */
  onNotificationTap?: (notification: NotificationTapEvent) => void;

  /**
   * Delay in ms after mount before requesting notification permission.
   * Set to 0 to request immediately. Set to -1 to never auto-request
   * (use `requestPermission()` from the hook instead).
   * @default -1
   */
  requestPermissionDelay?: number;

  /**
   * Expo project ID for push token registration.
   * Falls back to `Constants.expoConfig?.extra?.eas?.projectId`.
   */
  projectId?: string;

  /**
   * Callback to register the push token with your backend.
   * Called whenever a new push token is obtained.
   */
  onTokenRegistered?: (token: string, platform: "ios" | "android") => void;

  /**
   * Whether to show notifications when the app is in the foreground.
   * @default true
   */
  showForegroundNotifications?: boolean;

  /**
   * Optional filter to suppress foreground notifications.
   * Return false to suppress alert/sound for a specific notification.
   * The notification still appears in the notification center.
   */
  shouldShowForegroundNotification?: (
    data: Record<string, unknown>
  ) => boolean;
}

/** Event passed to onNotificationTap */
export interface NotificationTapEvent {
  /** Deep link path extracted from the notification, if present */
  deepLink?: string;
  /** Full notification data */
  data: Record<string, unknown>;
  /** Original notification ID */
  id: string;
}

// =============================================================================
// Hook Return Types
// =============================================================================

/** Return type for useNotifications() */
export interface UseNotificationsResult {
  /** The most recently received notification (foreground) */
  lastNotification: NotificationData | null;
  /** Whether the notification system is initialized */
  isReady: boolean;
}

/** Return type for useNotificationPermission() */
export interface UseNotificationPermissionResult {
  /** Current permission status */
  status: PermissionStatus;
  /** Request notification permission from the user */
  requestPermission: () => Promise<boolean>;
}

/** Return type for usePushToken() */
export interface UsePushTokenResult {
  /** The Expo push token for this device, or null if not available */
  token: string | null;
  /** Whether the token has been registered with the backend via onTokenRegistered */
  isRegistered: boolean;
}

// =============================================================================
// Android Channel Config
// =============================================================================

/** Android notification channel definition */
export interface AndroidNotificationChannel {
  /** Unique channel ID */
  id: string;
  /** User-visible channel name */
  name: string;
  /** User-visible description */
  description?: string;
  /** Importance level (1-5, maps to Android importance constants) */
  importance: 1 | 2 | 3 | 4 | 5;
  /** Whether to enable vibration */
  vibrate?: boolean;
  /** Whether to show badge */
  showBadge?: boolean;
  /** Sound file name (without extension) or null for silent */
  sound?: string | null;
}
