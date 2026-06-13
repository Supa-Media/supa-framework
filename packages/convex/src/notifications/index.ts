/**
 * Notification Utilities
 *
 * Functions for sending push notifications via the Expo Push API,
 * managing device tokens, and processing the notification queue.
 *
 * These are plain async functions — wrap them in Convex mutations/actions
 * in your app's convex functions.
 *
 * Usage:
 * ```ts
 * import { sendNotification, registerPushToken } from "@supa-media/convex/notifications";
 * ```
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// -- Types --

export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  image?: string;
  deepLink?: string;
  data?: Record<string, unknown>;
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: "default" | null;
  data?: Record<string, unknown>;
}

export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: Record<string, unknown>;
}

/** Minimal DB context for notification functions. */
interface NotificationCtx {
  db: {
    query: (table: string) => any;
    insert: (table: string, doc: any) => Promise<any>;
    patch: (id: any, fields: any) => Promise<void>;
    delete: (id: any) => Promise<void>;
  };
}

// -- Push Token Management --

/**
 * Register a device push token for the current user.
 * Upserts — if the token already exists, it's a no-op.
 */
export async function registerPushToken(
  ctx: NotificationCtx,
  userId: string,
  token: string,
  platform: "ios" | "android" | "web",
): Promise<void> {
  // Check if token already registered
  const existing = await ctx.db
    .query("pushTokens")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();

  if (existing) {
    // Update userId if token was reassigned to a different user
    if (existing.userId !== userId) {
      await ctx.db.patch(existing._id, { userId });
    }
    return;
  }

  await ctx.db.insert("pushTokens", {
    userId,
    token,
    platform,
    createdAt: Date.now(),
  });
}

/**
 * Remove expired or invalid push tokens for a user.
 * Call this after receiving "DeviceNotRegistered" errors from Expo.
 */
export async function cleanupExpiredTokens(
  ctx: NotificationCtx,
  invalidTokens: string[],
): Promise<number> {
  let removed = 0;
  for (const token of invalidTokens) {
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q: any) => q.eq("token", token))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      removed++;
    }
  }
  return removed;
}

// -- Notification Queue --

/**
 * Enqueue a notification for sending.
 * The notification is stored in the queue with "pending" status.
 */
export async function enqueueNotification(
  ctx: NotificationCtx,
  payload: NotificationPayload,
): Promise<string> {
  return await ctx.db.insert("notificationQueue", {
    userId: payload.userId,
    title: payload.title,
    body: payload.body,
    image: payload.image,
    deepLink: payload.deepLink,
    data: payload.data,
    status: "pending",
    createdAt: Date.now(),
  });
}

// -- Expo Push API --

/**
 * Send a single push notification via the Expo Push API.
 * This is an action-level function (requires network access).
 */
export async function sendPushNotification(
  messages: ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Expo Push API error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  return result.data as ExpoPushTicket[];
}

/**
 * Send a notification to a specific user by looking up their push tokens.
 * Returns the push tokens that received the notification.
 */
export async function sendNotificationToUser(
  ctx: NotificationCtx,
  payload: NotificationPayload,
): Promise<{ sent: number; tokens: string[] }> {
  const tokens = await ctx.db
    .query("pushTokens")
    .withIndex("by_userId", (q: any) => q.eq("userId", payload.userId))
    .collect();

  if (tokens.length === 0) {
    return { sent: 0, tokens: [] };
  }

  const messages: ExpoPushMessage[] = tokens.map((t: any) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    sound: "default" as const,
    data: {
      ...payload.data,
      deepLink: payload.deepLink,
    },
  }));

  await sendPushNotification(messages);

  return {
    sent: tokens.length,
    tokens: tokens.map((t: any) => t.token),
  };
}

/**
 * Process pending notifications from the queue.
 * Designed to be called from a cron job or scheduled function.
 *
 * @param batchSize - Max notifications to process per run (default 100)
 * @returns Count of processed notifications
 */
export async function processNotificationQueue(
  ctx: NotificationCtx,
  batchSize: number = 100,
): Promise<{ processed: number; failed: number }> {
  const pending = await ctx.db
    .query("notificationQueue")
    .withIndex("by_status", (q: any) => q.eq("status", "pending"))
    .take(batchSize);

  let processed = 0;
  let failed = 0;

  for (const notification of pending) {
    try {
      await sendNotificationToUser(ctx, {
        userId: notification.userId,
        title: notification.title,
        body: notification.body,
        image: notification.image,
        deepLink: notification.deepLink,
        data: notification.data,
      });

      await ctx.db.patch(notification._id, {
        status: "sent",
        sentAt: Date.now(),
      });
      processed++;
    } catch (error) {
      await ctx.db.patch(notification._id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      failed++;
    }
  }

  return { processed, failed };
}
