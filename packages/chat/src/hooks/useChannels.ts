/**
 * useChannels Hook
 *
 * Channel list with caching via the channel cache store.
 * Provides stale-while-revalidate: shows cached channels immediately,
 * then updates when the adapter returns fresh data.
 */

import { useState, useEffect } from "react";
import { useChannelCache } from "../stores/channelCache.js";
import type { ChatAdapter } from "../adapters/ChatAdapter.js";
import type { Channel } from "../types/index.js";

interface UseChannelsResult {
  channels: Channel[];
  isLoading: boolean;
  isStale: boolean;
}

/**
 * Fetch and cache channels for a group.
 *
 * @param adapter - Chat adapter instance
 * @param groupId - Group/scope to fetch channels for, or null to skip
 */
export function useChannels(
  adapter: ChatAdapter,
  groupId: string | null
): UseChannelsResult {
  const { getGroupChannels, setGroupChannels } = useChannelCache();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    if (!groupId) {
      setChannels([]);
      return;
    }

    // Show cached data immediately (stale-while-revalidate)
    const cached = getGroupChannels(groupId);
    if (cached) {
      setChannels(cached);
      setIsStale(true);
    }

    let cancelled = false;
    setIsLoading(true);

    // If the adapter supports subscriptions, use those
    if (adapter.subscribeChannels) {
      const unsubscribe = adapter.subscribeChannels(groupId, (freshChannels) => {
        if (!cancelled) {
          setChannels(freshChannels);
          setGroupChannels(groupId, freshChannels);
          setIsLoading(false);
          setIsStale(false);
        }
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    // Otherwise, fetch once
    const fetchChannels = async () => {
      try {
        const result = await adapter.getChannels(groupId);
        if (!cancelled && result) {
          setChannels(result);
          setGroupChannels(groupId, result);
          setIsStale(false);
        }
      } catch (err) {
        console.error("[useChannels] Failed to fetch channels:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchChannels();

    return () => {
      cancelled = true;
    };
  }, [adapter, groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { channels, isLoading, isStale };
}
