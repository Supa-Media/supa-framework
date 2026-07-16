/**
 * Notification configuration — Android channels and default categories.
 */

import type { AndroidNotificationChannel } from "../types/index.js";

// =============================================================================
// Android Notification Channels
// =============================================================================

/**
 * Default Android notification channels.
 * Apps can override these by calling `setupAndroidChannels()` with custom channels.
 */
export const DEFAULT_ANDROID_CHANNELS: AndroidNotificationChannel[] = [
  {
    id: "default",
    name: "General",
    description: "General notifications",
    importance: 3,
    vibrate: true,
    showBadge: true,
  },
  {
    id: "messages",
    name: "Messages",
    description: "Chat messages and mentions",
    importance: 4,
    vibrate: true,
    showBadge: true,
  },
  {
    id: "reminders",
    name: "Reminders",
    description: "Event reminders and scheduled alerts",
    importance: 3,
    vibrate: true,
    showBadge: false,
  },
  {
    id: "updates",
    name: "Updates",
    description: "App updates and announcements",
    importance: 2,
    vibrate: false,
    showBadge: false,
  },
];

// =============================================================================
// Channel Setup
// =============================================================================

/**
 * Set up Android notification channels.
 * No-op on iOS and web. Safe to call on any platform.
 *
 * @param channels - Custom channels to register. Defaults to `DEFAULT_ANDROID_CHANNELS`.
 */
export async function setupAndroidChannels(
  channels: AndroidNotificationChannel[] = DEFAULT_ANDROID_CHANNELS
): Promise<void> {
  const { Platform } = require("react-native");
  if (Platform.OS !== "android") return;

  let Notifications: typeof import("expo-notifications") | null = null;
  try {
    Notifications = require("expo-notifications");
  } catch {
    // expo-notifications not installed — nothing to configure
    return;
  }

  for (const channel of channels) {
    await Notifications!.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      description: channel.description,
      importance: channel.importance,
      vibrationPattern: channel.vibrate ? [0, 250, 250, 250] : undefined,
      showBadge: channel.showBadge ?? true,
      sound: channel.sound ?? undefined,
    });
  }
}
