/**
 * Notification handlers — background handling and deep link resolution.
 */

// =============================================================================
// Background Handler
// =============================================================================

/**
 * Register the background notification handler.
 * Must be called at the top level of your app entry file (outside of components).
 *
 * ```ts
 * // app/_layout.tsx (top level, outside component)
 * import { registerBackgroundHandler } from "@supa/notifications/handlers";
 * registerBackgroundHandler();
 * ```
 */
export function registerBackgroundHandler(
  handler?: (notification: unknown) => void
): void {
  let Notifications: typeof import("expo-notifications") | null = null;
  try {
    Notifications = require("expo-notifications");
  } catch {
    // expo-notifications not installed — skip background handler
    return;
  }

  Notifications!.registerTaskAsync?.("BACKGROUND_NOTIFICATION_TASK").catch(
    () => {
      // Task registration may fail on simulators or web — that's fine
    }
  );

  // Set a default background handler that does nothing
  // (foreground handling is done by the provider)
  Notifications!.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (handler) {
    Notifications!.addNotificationReceivedListener((notification) => {
      handler(notification);
    });
  }
}

// =============================================================================
// Deep Link Resolution
// =============================================================================

/**
 * Parse a deep link URL into an Expo Router-compatible path.
 *
 * Handles formats:
 * - Absolute URLs: `https://app.example.com/groups/123` → `/groups/123`
 * - App scheme URLs: `myapp://groups/123` → `/groups/123`
 * - Relative paths: `/groups/123` → `/groups/123` (passthrough)
 *
 * @param deepLink - The deep link URL to parse
 * @returns The resolved path suitable for `router.push()`
 */
export function resolveDeepLink(deepLink: string): string {
  if (!deepLink) return "/";

  // Already a relative path — return as-is
  if (deepLink.startsWith("/")) {
    return deepLink;
  }

  try {
    const url = new URL(deepLink);
    // Extract pathname + search + hash
    return url.pathname + url.search + url.hash;
  } catch {
    // Not a valid URL — treat as a relative path
    return deepLink.startsWith("/") ? deepLink : `/${deepLink}`;
  }
}
