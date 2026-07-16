/**
 * useSendMessage Hook
 *
 * Send messages with optimistic updates and offline queuing.
 *
 * Copied from Togather's battle-tested useConvexSendMessage.ts, made
 * adapter-agnostic. Shows messages immediately in the UI with "sending"
 * status, then updates to "sent" when the server confirms.
 *
 * Supports offline queuing: messages sent while disconnected are queued
 * and automatically flushed when the connection restores.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatAdapter } from "../adapters/ChatAdapter.js";
import type {
  OptimisticMessage,
  SendMessageOptions,
  UseSendMessageResult,
} from "../types/index.js";

/**
 * Send messages with optimistic updates.
 *
 * @param adapter - Chat adapter instance
 * @param channelId - The channel ID to send messages to, or null to disable
 * @param isOffline - Whether the device is currently offline (enables queuing)
 * @returns sendMessage function, optimistic messages, sending state, retry, and dismiss
 *
 * @example
 * ```tsx
 * const { sendMessage, optimisticMessages, isSending } = useSendMessage(adapter, channelId, false);
 *
 * const handleSend = async () => {
 *   await sendMessage("Hello!", {
 *     mentionedUserIds: [userId],
 *   });
 * };
 * ```
 */
export function useSendMessage(
  adapter: ChatAdapter,
  channelId: string | null,
  isOffline: boolean = false
): UseSendMessageResult {
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  // Counter for generating unique optimistic IDs
  const optimisticIdCounter = useRef(0);

  // Queue for messages sent while offline
  const messageQueueRef = useRef<
    Array<{ optimisticId: string; content: string; options?: SendMessageOptions }>
  >([]);

  // Track previous offline state for flush detection
  const wasOfflineRef = useRef(isOffline);

  /**
   * Internal function to actually send a message via the adapter
   */
  const executeSend = useCallback(
    async (optimisticId: string, content: string, options?: SendMessageOptions) => {
      if (!channelId) return;

      // Update status to sending
      setOptimisticMessages((prev) =>
        prev.map((msg) =>
          msg._id === optimisticId
            ? { ...msg, _status: "sending" as const }
            : msg
        )
      );

      try {
        await adapter.sendMessage(channelId, content, options);

        // Update optimistic message status to "sent"
        setOptimisticMessages((prev) =>
          prev.map((msg) =>
            msg._id === optimisticId
              ? { ...msg, _status: "sent" as const }
              : msg
          )
        );

        // Remove optimistic message after a delay as state cleanup fallback.
        // MessageList deduplicates visually (hides 'sent' optimistic messages
        // once the matching real message arrives from the subscription), so this
        // timeout only needs to clean up state — keep it generous to avoid a
        // disappearing-message gap on slow/reconnecting connections.
        setTimeout(() => {
          setOptimisticMessages((prev) =>
            prev.filter((msg) => msg._id !== optimisticId)
          );
        }, 3000);
      } catch (error) {
        console.error("[useSendMessage] Failed to send message:", error);

        // Mark optimistic message as error (NO auto-removal - user must retry or dismiss)
        setOptimisticMessages((prev) =>
          prev.map((msg) =>
            msg._id === optimisticId
              ? { ...msg, _status: "error" as const }
              : msg
          )
        );

        throw error;
      }
    },
    [channelId, adapter]
  );

  /**
   * Send a message with optimistic update
   */
  const sendMessage = useCallback(
    async (content: string, options?: SendMessageOptions) => {
      if (!channelId) {
        console.warn("[useSendMessage] Cannot send message: missing channelId");
        return;
      }

      const currentUser = adapter.getCurrentUser();
      if (!currentUser) {
        console.warn("[useSendMessage] Cannot send message: no current user");
        return;
      }

      // Generate optimistic message
      const optimisticId = `optimistic-${Date.now()}-${optimisticIdCounter.current++}`;
      const now = Date.now();

      // Determine content type
      let contentType: "text" | "image" | "file" | "video" | "audio" | "system" = "text";
      if (options?.attachments && options.attachments.length > 0) {
        const hasImage = options.attachments.some((a) => a.type === "image");
        const hasFile = options.attachments.some((a) => a.type === "file");
        if (hasImage) contentType = "image";
        else if (hasFile) contentType = "file";
      }

      const optimisticMessage: OptimisticMessage = {
        _id: optimisticId,
        channelId,
        senderId: currentUser.id,
        content,
        contentType,
        attachments: options?.attachments,
        parentMessageId: options?.parentMessageId,
        createdAt: now,
        isDeleted: false,
        senderName: currentUser.name,
        senderProfilePhoto: currentUser.profilePhoto,
        mentionedUserIds: options?.mentionedUserIds,
        _optimistic: true,
        _status: isOffline ? "queued" : "sending",
      };

      // Add optimistic message to state
      setOptimisticMessages((prev) => [...prev, optimisticMessage]);

      if (isOffline) {
        // Queue for later
        messageQueueRef.current.push({ optimisticId, content, options });
        return;
      }

      setIsSending(true);

      try {
        await executeSend(optimisticId, content, options);
      } catch (error) {
        console.error("[useSendMessage] Failed to send:", error);
        throw error;
      } finally {
        setIsSending(false);
      }
    },
    [channelId, adapter, isOffline, executeSend]
  );

  // Flush queue when connection restores (offline -> online transition)
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && messageQueueRef.current.length > 0) {
      const queue = [...messageQueueRef.current];
      messageQueueRef.current = [];

      const flushQueue = async () => {
        for (const item of queue) {
          try {
            await executeSend(item.optimisticId, item.content, item.options);
          } catch (error) {
            console.error("[useSendMessage] Failed to flush queued message:", error);
          }
        }
      };

      flushQueue();
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, executeSend]);

  /**
   * Retry a failed message
   */
  const retryMessage = useCallback(
    async (optimisticId: string) => {
      const msg = optimisticMessages.find((m) => m._id === optimisticId);
      if (!msg || msg._status !== "error") return;

      try {
        await executeSend(optimisticId, msg.content);
      } catch (error) {
        console.error("[useSendMessage] Retry failed:", error);
      }
    },
    [optimisticMessages, executeSend]
  );

  /**
   * Dismiss a failed message (remove from optimistic list)
   */
  const dismissMessage = useCallback(
    (optimisticId: string) => {
      setOptimisticMessages((prev) => prev.filter((msg) => msg._id !== optimisticId));
    },
    []
  );

  return {
    sendMessage,
    optimisticMessages,
    isSending,
    retryMessage,
    dismissMessage,
  };
}
