/**
 * Hooks for consuming notification state from NotificationProvider.
 */

import { useContext } from "react";
import { NotificationContext } from "../providers/NotificationContext.js";
import type {
  UseNotificationsResult,
  UseNotificationPermissionResult,
  UsePushTokenResult,
} from "../types/index.js";

/**
 * Access the most recent notification and readiness state.
 *
 * Must be used within a `<NotificationProvider>`.
 */
export function useNotifications(): UseNotificationsResult {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      "useNotifications must be used within a <NotificationProvider>"
    );
  }
  return {
    lastNotification: ctx.lastNotification,
    isReady: ctx.isReady,
  };
}

/**
 * Access notification permission status and request function.
 *
 * Must be used within a `<NotificationProvider>`.
 */
export function useNotificationPermission(): UseNotificationPermissionResult {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      "useNotificationPermission must be used within a <NotificationProvider>"
    );
  }
  return {
    status: ctx.permissionStatus,
    requestPermission: ctx.requestPermission,
  };
}

/**
 * Access the push token and its registration status.
 *
 * Must be used within a `<NotificationProvider>`.
 */
export function usePushToken(): UsePushTokenResult {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      "usePushToken must be used within a <NotificationProvider>"
    );
  }
  return {
    token: ctx.pushToken,
    isRegistered: ctx.isTokenRegistered,
  };
}
