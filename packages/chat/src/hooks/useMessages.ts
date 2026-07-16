/**
 * useMessages Hook
 *
 * Paginated message list with real-time updates.
 * Automatically subscribes to new messages and provides pagination support.
 *
 * Copied from Togather's battle-tested useMessages.ts, made adapter-agnostic.
 *
 * Architecture:
 * - A live subscription (cursor=undefined) always watches the latest messages.
 * - When the user scrolls up, a pagination query fetches older messages.
 * - Once the pagination response arrives, older messages are merged into an
 *   accumulator and the cursor is reset so the live subscription resumes.
 * - The final message list merges the live result with the accumulated older
 *   messages, deduplicating by ID.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useMessageCache } from "../stores/messageCache.js";
import type { ChatAdapter } from "../adapters/ChatAdapter.js";
import type { Message, PaginatedMessagesResult, UseMessagesResult } from "../types/index.js";

/**
 * Subscribe to messages for a channel with pagination.
 *
 * This is the adapter-agnostic version. It polls the adapter for messages
 * and supports pagination. For Convex backends, you may prefer to use
 * `useConvexMessages` which leverages `useQuery` for true reactivity.
 *
 * @param adapter - Chat adapter instance
 * @param channelId - The channel ID to fetch messages from, or null to skip
 * @param limit - Number of messages to fetch per page (default: 20)
 * @returns Messages array, pagination functions, and loading state
 */
export function useMessages(
  adapter: ChatAdapter,
  channelId: string | null,
  limit: number = 20
): UseMessagesResult {
  const { getChannelMessages, setChannelMessages } = useMessageCache();

  // Pagination cursor
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  // Accumulated older messages from pagination
  const olderMessagesRef = useRef<{ channelId: string | null; messages: Message[] }>({
    channelId: null,
    messages: [],
  });

  // Last live page snapshot — used when cursor is set and live data is temporarily unavailable
  const liveMessagesSnapshotRef = useRef<Message[]>([]);

  const [hasMore, setHasMore] = useState(false);
  const isLoadingMoreRef = useRef(false);
  const lastCursorRef = useRef<string | undefined>(undefined);

  // Live query result
  const [result, setResult] = useState<PaginatedMessagesResult | undefined>(undefined);
  const [isQueryLoading, setIsQueryLoading] = useState(false);

  // Reset when channelId changes
  const prevChannelIdRef = useRef<string | null>(null);
  if (channelId !== prevChannelIdRef.current) {
    if (prevChannelIdRef.current !== null) {
      setCursor(undefined);
    }
    prevChannelIdRef.current = channelId;
    isLoadingMoreRef.current = false;
    olderMessagesRef.current = { channelId: null, messages: [] };
    lastCursorRef.current = undefined;
    liveMessagesSnapshotRef.current = [];
  }

  // Fetch messages from adapter
  useEffect(() => {
    if (!channelId) {
      setResult(undefined);
      return;
    }

    let cancelled = false;
    setIsQueryLoading(true);

    const fetchData = async () => {
      try {
        const data = await adapter.getMessages(channelId, limit, cursor);
        if (!cancelled && data) {
          setResult(data);
          setIsQueryLoading(false);
        }
      } catch (err) {
        console.error("[useMessages] Failed to fetch messages:", err);
        if (!cancelled) setIsQueryLoading(false);
      }
    };

    // If the adapter supports subscriptions, use those instead of polling
    if (adapter.subscribeMessages && cursor === undefined) {
      const unsubscribe = adapter.subscribeMessages(channelId, limit, (data) => {
        if (!cancelled) {
          setResult(data);
          setIsQueryLoading(false);
        }
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [adapter, channelId, limit, cursor]);

  // Handle query results — merge pagination, update cursors
  useEffect(() => {
    if (result && channelId) {
      if (cursor !== undefined) {
        // Pagination result — merge older messages, then reset cursor
        const existingIds = new Set(olderMessagesRef.current.messages.map((m) => m._id));
        const newOlderMessages = (result.messages || []).filter(
          (m) => !existingIds.has(m._id)
        );
        olderMessagesRef.current = {
          channelId,
          messages: [...olderMessagesRef.current.messages, ...newOlderMessages],
        };
        setHasMore(result.hasMore || false);
        lastCursorRef.current = result.cursor;
        setCursor(undefined);
      } else {
        // Live subscription result
        isLoadingMoreRef.current = false;
        if (olderMessagesRef.current.messages.length === 0) {
          setHasMore(result.hasMore || false);
          lastCursorRef.current = result.cursor;
        }
      }
    }
  }, [result, cursor, channelId]);

  // Cache messages for offline use (only the live page)
  useEffect(() => {
    if (result && channelId && result.messages && result.messages.length > 0 && cursor === undefined) {
      setChannelMessages(channelId, result.messages);
    }
  }, [result, channelId, cursor, setChannelMessages]);

  // Snapshot live messages for use during pagination transitions
  useEffect(() => {
    if (channelId && result?.messages && cursor === undefined) {
      liveMessagesSnapshotRef.current = result.messages;
    }
  }, [result?.messages, cursor, channelId]);

  // Merge live messages with accumulated older messages
  const mergedMessages = useMemo(() => {
    const liveMessages =
      cursor === undefined
        ? (result?.messages ??
          (liveMessagesSnapshotRef.current.length > 0
            ? liveMessagesSnapshotRef.current
            : []))
        : liveMessagesSnapshotRef.current.length > 0
          ? liveMessagesSnapshotRef.current
          : [];

    if (liveMessages.length === 0 && olderMessagesRef.current.channelId !== channelId) {
      return [];
    }
    const olderMessages = olderMessagesRef.current.channelId === channelId
      ? olderMessagesRef.current.messages
      : [];

    if (olderMessages.length === 0) return liveMessages;
    if (liveMessages.length === 0) return olderMessages;

    // Merge: live messages (newest) + older messages, deduplicating by ID
    const seenIds = new Set<string>();
    const merged: Message[] = [];

    for (const msg of liveMessages) {
      if (!seenIds.has(msg._id)) {
        seenIds.add(msg._id);
        merged.push(msg);
      }
    }

    for (const msg of olderMessages) {
      if (!seenIds.has(msg._id)) {
        seenIds.add(msg._id);
        merged.push(msg);
      }
    }

    // Sort by createdAt ascending (oldest first)
    merged.sort((a, b) => a.createdAt - b.createdAt);
    return merged;
  }, [result?.messages, channelId, cursor]);

  // Load more messages (pagination)
  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current) return;
    if (!lastCursorRef.current) return;

    isLoadingMoreRef.current = true;
    setCursor(lastCursorRef.current);
  }, []);

  // Determine loading/stale state
  const isPaginating = isLoadingMoreRef.current;

  let messages: Message[];
  let isStale = false;

  if (isPaginating) {
    messages = mergedMessages.length > 0 ? mergedMessages : [];
  } else if (isQueryLoading && channelId) {
    if (mergedMessages.length > 0) {
      messages = mergedMessages;
    } else {
      const cached = getChannelMessages(channelId);
      if (cached && cached.length > 0) {
        messages = cached;
        isStale = true;
      } else {
        messages = [];
      }
    }
  } else {
    messages = mergedMessages;
  }

  const isLoading = isQueryLoading && !isStale && !isPaginating;

  return {
    messages,
    loadMore,
    hasMore,
    isLoading,
    isStale,
  };
}
