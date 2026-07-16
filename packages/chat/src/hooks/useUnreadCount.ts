/**
 * useUnreadCount Hook
 *
 * Tracks unread message count for a channel via the adapter.
 */

import { useState, useEffect } from "react";
import type { ChatAdapter } from "../adapters/ChatAdapter.js";

interface UseUnreadCountResult {
  unreadCount: number;
  isLoading: boolean;
}

/**
 * Get unread message count for a channel.
 *
 * @param adapter - Chat adapter instance
 * @param channelId - Channel to check, or null to skip
 */
export function useUnreadCount(
  adapter: ChatAdapter,
  channelId: string | null
): UseUnreadCountResult {
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!channelId || !adapter.getUnreadCount) {
      setUnreadCount(0);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const fetchCount = async () => {
      try {
        const count = await adapter.getUnreadCount!(channelId);
        if (!cancelled && count !== undefined) {
          setUnreadCount(count);
        }
      } catch (err) {
        console.error("[useUnreadCount] Failed to fetch unread count:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchCount();

    return () => {
      cancelled = true;
    };
  }, [adapter, channelId]);

  return { unreadCount, isLoading };
}
