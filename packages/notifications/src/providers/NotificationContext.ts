/**
 * Shared context for NotificationProvider.
 */

import { createContext } from "react";
import type { NotificationData, PermissionStatus } from "../types/index.js";

export interface NotificationContextValue {
  pushToken: string | null;
  isTokenRegistered: boolean;
  permissionStatus: PermissionStatus;
  lastNotification: NotificationData | null;
  isReady: boolean;
  requestPermission: () => Promise<boolean>;
}

export const NotificationContext =
  createContext<NotificationContextValue | null>(null);
