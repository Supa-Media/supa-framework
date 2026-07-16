/**
 * NotificationProvider — push notification lifecycle manager.
 *
 * Wraps your app to handle:
 * - Permission requests (with configurable delay)
 * - Expo push token registration
 * - Foreground notification display
 * - Notification tap → deep link navigation
 * - Graceful no-op on web and simulators
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Platform } from "react-native";
import { NotificationContext } from "./NotificationContext.js";
import type {
  NotificationProviderConfig,
  NotificationData,
  NotificationTapEvent,
  PermissionStatus,
} from "../types/index.js";
import { resolveDeepLink } from "../handlers/index.js";
import { setupAndroidChannels } from "../config/index.js";

// ---------------------------------------------------------------------------
// Optional native dependencies — imported dynamically so the provider
// never crashes if expo-notifications / expo-device aren't installed.
// ---------------------------------------------------------------------------

let Notifications: typeof import("expo-notifications") | null = null;
let Device: typeof import("expo-device") | null = null;
let Constants: typeof import("expo-constants") | null = null;

try {
  Notifications = require("expo-notifications");
} catch {
  // expo-notifications not installed
}

try {
  Device = require("expo-device");
} catch {
  // expo-device not installed
}

try {
  Constants = require("expo-constants");
} catch {
  // expo-constants not installed
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface NotificationProviderProps extends NotificationProviderConfig {
  children: React.ReactNode;
}

export function NotificationProvider({
  children,
  onNotificationTap,
  requestPermissionDelay = -1,
  projectId,
  onTokenRegistered,
  showForegroundNotifications = true,
  shouldShowForegroundNotification,
}: NotificationProviderProps) {
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [isTokenRegistered, setIsTokenRegistered] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus>("undetermined");
  const [lastNotification, setLastNotification] =
    useState<NotificationData | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Refs for listener cleanup
  const notificationListenerRef = useRef<any>(null);
  const responseListenerRef = useRef<any>(null);
  // Track handled notification IDs to prevent duplicate navigation
  const handledIds = useRef<Set<string>>(new Set());

  // Stable ref for onNotificationTap to avoid re-triggering effects
  const onTapRef = useRef(onNotificationTap);
  useEffect(() => {
    onTapRef.current = onNotificationTap;
  }, [onNotificationTap]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const isNativeAvailable = useCallback((): boolean => {
    if (Platform.OS === "web") return false;
    if (!Notifications || !Device) return false;
    return true;
  }, []);

  const isPhysicalDevice = useCallback((): boolean => {
    if (!Device) return false;
    return Device.isDevice;
  }, []);

  // ---------------------------------------------------------------------------
  // Permission
  // ---------------------------------------------------------------------------

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isNativeAvailable()) {
      setPermissionStatus("denied");
      return false;
    }

    if (!isPhysicalDevice()) {
      console.warn(
        "[@supa-media/notifications] Push notifications require a physical device"
      );
      setPermissionStatus("denied");
      return false;
    }

    try {
      const { status: existing } =
        await Notifications!.getPermissionsAsync();
      let finalStatus = existing;

      if (existing !== "granted") {
        const { status } = await Notifications!.requestPermissionsAsync();
        finalStatus = status;
      }

      const granted = finalStatus === "granted";
      setPermissionStatus(granted ? "granted" : "denied");
      return granted;
    } catch (error) {
      console.error(
        "[@supa-media/notifications] Error requesting permission:",
        error
      );
      setPermissionStatus("denied");
      return false;
    }
  }, [isNativeAvailable, isPhysicalDevice]);

  // ---------------------------------------------------------------------------
  // Token Registration
  // ---------------------------------------------------------------------------

  const registerToken = useCallback(async () => {
    if (!Notifications) return;
    if (Platform.OS === "web") return;

    const resolvedProjectId =
      projectId ??
      (Constants?.default as any)?.expoConfig?.extra?.eas?.projectId;

    if (!resolvedProjectId) {
      console.warn(
        "[@supa-media/notifications] No projectId available for push token. " +
          "Pass projectId prop or configure eas.projectId in app config."
      );
      return;
    }

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: resolvedProjectId,
      });
      const token = tokenData.data;

      setPushToken(token);

      // Notify the app so it can register with its backend
      const platform = Platform.OS as "ios" | "android";
      onTokenRegistered?.(token, platform);
      setIsTokenRegistered(true);
    } catch (error) {
      console.error(
        "[@supa-media/notifications] Failed to get push token:",
        error
      );
    }
  }, [projectId, onTokenRegistered]);

  // ---------------------------------------------------------------------------
  // Foreground handler
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!Notifications) return;

    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data as Record<
          string,
          unknown
        >;

        // Let the app filter foreground notifications
        const shouldShow =
          showForegroundNotifications &&
          (shouldShowForegroundNotification
            ? shouldShowForegroundNotification(data)
            : true);

        return {
          shouldShowAlert: shouldShow,
          shouldPlaySound: shouldShow,
          shouldSetBadge: true,
          shouldShowBanner: shouldShow,
          shouldShowList: true,
        };
      },
    });
  }, [showForegroundNotifications, shouldShowForegroundNotification]);

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isNativeAvailable()) {
      // Web or missing native deps — mark as ready and bail
      setIsReady(true);
      return;
    }

    let mounted = true;

    const initialize = async () => {
      // Set up Android channels
      await setupAndroidChannels();

      // Check current permission status
      try {
        const { status } = await Notifications!.getPermissionsAsync();
        if (mounted) {
          setPermissionStatus(
            status === "granted"
              ? "granted"
              : status === "denied"
                ? "denied"
                : "undetermined"
          );
        }

        // If already granted, register token immediately
        if (status === "granted") {
          await registerToken();
        }
      } catch (error) {
        console.error(
          "[@supa-media/notifications] Error checking permissions:",
          error
        );
      }

      // Handle cold-start notification (app launched from killed state via tap)
      try {
        const lastResponse =
          await Notifications!.getLastNotificationResponseAsync();
        if (lastResponse) {
          const notificationId =
            lastResponse.notification.request.identifier;
          if (!handledIds.current.has(notificationId)) {
            handledIds.current.add(notificationId);
            const data = lastResponse.notification.request.content
              .data as Record<string, unknown>;
            const deepLink = (data?.url ?? data?.deepLink) as
              | string
              | undefined;

            // Delay to ensure the app/navigation is fully mounted
            setTimeout(() => {
              const event: NotificationTapEvent = {
                deepLink: deepLink ? resolveDeepLink(deepLink) : undefined,
                data,
                id: notificationId,
              };
              onTapRef.current?.(event);
            }, 500);
          }
        }
      } catch (error) {
        console.error(
          "[@supa-media/notifications] Error reading initial notification:",
          error
        );
      }

      if (mounted) setIsReady(true);
    };

    initialize();

    // Listen for notifications received while app is in foreground
    notificationListenerRef.current =
      Notifications!.addNotificationReceivedListener((notification) => {
        const parsed: NotificationData = {
          id: notification.request.identifier,
          title: notification.request.content.title || "",
          body: notification.request.content.body || "",
          data: (notification.request.content.data || {}) as Record<
            string,
            unknown
          >,
        };
        setLastNotification(parsed);
      });

    // Listen for notification taps
    responseListenerRef.current =
      Notifications!.addNotificationResponseReceivedListener((response) => {
        const notificationId = response.notification.request.identifier;

        // Deduplicate — cold-start handler may have already processed this
        if (handledIds.current.has(notificationId)) return;
        handledIds.current.add(notificationId);

        const data = response.notification.request.content.data as Record<
          string,
          unknown
        >;
        const deepLink = (data?.url ?? data?.deepLink) as
          | string
          | undefined;

        const event: NotificationTapEvent = {
          deepLink: deepLink ? resolveDeepLink(deepLink) : undefined,
          data,
          id: notificationId,
        };
        onTapRef.current?.(event);
      });

    return () => {
      mounted = false;
      notificationListenerRef.current?.remove();
      responseListenerRef.current?.remove();
    };
  }, [isNativeAvailable, registerToken]);

  // ---------------------------------------------------------------------------
  // Auto-request permission with delay
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (requestPermissionDelay < 0) return;
    if (!isNativeAvailable()) return;
    if (permissionStatus === "granted") return;

    const timer = setTimeout(async () => {
      const granted = await requestPermission();
      if (granted) {
        await registerToken();
      }
    }, requestPermissionDelay);

    return () => clearTimeout(timer);
    // Only run once on mount (or when delay changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestPermissionDelay]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <NotificationContext.Provider
      value={{
        pushToken,
        isTokenRegistered,
        permissionStatus,
        lastNotification,
        isReady,
        requestPermission,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
