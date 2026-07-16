/**
 * MessageList Component
 *
 * A virtualized list of messages with pagination and date separators.
 * Uses an inverted FlatList for reliable chat behavior — newest messages
 * appear at the bottom and the list naturally starts there.
 *
 * Copied from Togather's battle-tested MessageList, made generic with
 * a `renderMessage` prop for custom message bubbles.
 *
 * Features:
 * - Inverted FlatList (standard chat pattern)
 * - Pagination (load more messages on scroll up)
 * - Date separators (Today, Yesterday, or formatted date)
 * - Grouped messages (hide sender info for consecutive messages from same sender)
 * - Optimistic message deduplication
 * - Scroll-to-bottom button
 * - Loading states (initial load, pagination, stale cache)
 * - Empty states
 */

import React, { useRef, useCallback, useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  FlatList,
  type ViewToken,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import type { Message, OptimisticMessage, UseMessagesResult } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageListTheme {
  /** Background color of the list container */
  background?: string;
  /** Text color for date separators */
  dateSeparatorText?: string;
  /** Line color for date separators */
  dateSeparatorLine?: string;
  /** Text color for empty state */
  emptyText?: string;
  /** Text color for secondary empty state text */
  emptySubtext?: string;
  /** Loading indicator / accent color */
  accentColor?: string;
  /** Scroll-to-bottom button background */
  scrollButtonColor?: string;
  /** Warning text color for stale cache banner */
  warningColor?: string;
  /** Secondary text color */
  textSecondary?: string;
}

export interface RenderMessageProps {
  message: Message;
  /** Whether to show the sender name/avatar (first message in a group) */
  showSenderInfo: boolean;
  /** Whether this is an optimistic (not yet confirmed) message */
  isOptimistic?: boolean;
  /** Status of optimistic message */
  optimisticStatus?: "sending" | "sent" | "error" | "queued";
}

export interface MessageListProps {
  /** Messages result from useMessages hook */
  messagesResult: UseMessagesResult;
  /** Render function for message bubbles */
  renderMessage: (props: RenderMessageProps) => React.ReactElement;
  /** Optimistic messages to render inline */
  optimisticMessages?: OptimisticMessage[];
  /** Current user ID for deduplication */
  currentUserId?: string;
  /** Theme overrides */
  theme?: MessageListTheme;
  /** Custom empty state component */
  renderEmpty?: () => React.ReactElement;
  /** Custom loading component */
  renderLoading?: () => React.ReactElement;
  /** Container style overrides */
  style?: StyleProp<ViewStyle>;
  /** Content container style overrides */
  contentContainerStyle?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateSeparator(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[date.getMonth()];
  const day = date.getDate();

  if (date.getFullYear() !== today.getFullYear()) {
    return `${month} ${day}, ${date.getFullYear()}`;
  }

  return `${month} ${day}`;
}

type ListItem =
  | { type: "message"; data: Message; showSenderInfo: boolean; isOptimistic?: boolean; optimisticStatus?: string }
  | { type: "dateSeparator"; date: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessageList({
  messagesResult,
  renderMessage,
  optimisticMessages,
  currentUserId,
  theme = {},
  renderEmpty,
  renderLoading,
  style,
  contentContainerStyle,
}: MessageListProps) {
  const { messages, loadMore, hasMore, isLoading, isStale } = messagesResult;
  const listRef = useRef<FlatList<ListItem>>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Colors with defaults
  const bg = theme.background ?? "#fff";
  const accent = theme.accentColor ?? "#007AFF";
  const scrollBtnColor = theme.scrollButtonColor ?? accent;

  // Delay showing empty state to avoid flash during subscription startup
  const [showEmptyState, setShowEmptyState] = useState(false);
  const emptyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isLoading && messages.length === 0) {
      emptyTimerRef.current = setTimeout(() => setShowEmptyState(true), 500);
    } else {
      setShowEmptyState(false);
      if (emptyTimerRef.current) {
        clearTimeout(emptyTimerRef.current);
        emptyTimerRef.current = null;
      }
    }
    return () => {
      if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
    };
  }, [isLoading, messages.length]);

  // Transform messages into list items with date separators and grouping
  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    messages.forEach((msg, index) => {
      const previousMsg = index > 0 ? messages[index - 1] : undefined;

      const isFirstOfDate =
        !previousMsg ||
        new Date(msg.createdAt).toDateString() !==
          new Date(previousMsg.createdAt).toDateString();

      const showSenderInfo = !previousMsg || msg.senderId !== previousMsg.senderId;

      if (isFirstOfDate) {
        items.push({
          type: "dateSeparator",
          date: formatDateSeparator(msg.createdAt),
        });
      }

      items.push({ type: "message", data: msg, showSenderInfo });
    });

    // Append optimistic messages with deduplication
    if (optimisticMessages && optimisticMessages.length > 0) {
      const lastServerMsg = messages.length > 0 ? messages[messages.length - 1] : undefined;
      const recentServerMessages = messages.slice(-5);
      const matchedServerIds = new Set<string>();

      const pendingOptimistic = optimisticMessages.filter((optMsg) => {
        if (optMsg._status !== "sent") return true;
        const match = recentServerMessages.find(
          (serverMsg) =>
            !matchedServerIds.has(serverMsg._id) &&
            serverMsg.senderId === optMsg.senderId &&
            serverMsg.content === optMsg.content &&
            Math.abs(serverMsg.createdAt - optMsg.createdAt) < 5000
        );
        if (match) {
          matchedServerIds.add(match._id);
          return false;
        }
        return true;
      });

      pendingOptimistic.forEach((optMsg, index) => {
        const prevMsg = index === 0 ? lastServerMsg : pendingOptimistic[index - 1];
        const showSenderInfo = !prevMsg || optMsg.senderId !== prevMsg.senderId;

        items.push({
          type: "message",
          data: optMsg as unknown as Message,
          showSenderInfo,
          isOptimistic: true,
          optimisticStatus: optMsg._status,
        });
      });
    }

    // Reverse for inverted list (newest first)
    return items.reverse();
  }, [messages, optimisticMessages]);

  // Scroll detection for scroll-to-bottom button
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) return;
      const hasIndex0Visible = viewableItems.some((item) => item.index === 0);
      const smallestVisibleIndex = Math.min(
        ...viewableItems.map((item) => item.index ?? Infinity)
      );
      const nearBottom = hasIndex0Visible || smallestVisibleIndex <= 2;
      setShowScrollToBottom(!nearBottom);
    },
    []
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      loadMore();
    }
  }, [hasMore, isLoading, loadMore]);

  const handleScrollToBottom = useCallback(() => {
    listRef.current?.scrollToIndex({ index: 0, animated: true });
  }, []);

  // Render items
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "dateSeparator") {
        return (
          <View style={styles.dateSeparatorContainer}>
            <View
              style={[
                styles.dateSeparatorLine,
                { backgroundColor: theme.dateSeparatorLine ?? "#E5E5EA" },
              ]}
            />
            <Text
              style={[
                styles.dateSeparatorText,
                { color: theme.dateSeparatorText ?? "#8E8E93" },
              ]}
            >
              {item.date}
            </Text>
            <View
              style={[
                styles.dateSeparatorLine,
                { backgroundColor: theme.dateSeparatorLine ?? "#E5E5EA" },
              ]}
            />
          </View>
        );
      }

      return renderMessage({
        message: item.data,
        showSenderInfo: item.showSenderInfo,
        isOptimistic: item.isOptimistic,
        optimisticStatus: item.optimisticStatus as any,
      });
    },
    [renderMessage, theme]
  );

  const keyExtractor = useCallback(
    (item: ListItem, index: number) =>
      item.type === "dateSeparator"
        ? `date-${item.date}-${index}`
        : `msg-${item.data._id}`,
    []
  );

  // Loading / waiting state — show empty container
  if (messages.length === 0 && !showEmptyState) {
    if (renderLoading) return renderLoading();
    return <View style={[styles.container, { backgroundColor: bg }]} />;
  }

  // Empty state
  if (showEmptyState && messages.length === 0) {
    if (renderEmpty) return renderEmpty();
    return (
      <View style={[styles.centerContainer, { backgroundColor: bg }]}>
        <Text style={[styles.emptyTitle, { color: theme.emptyText ?? "#000" }]}>
          No messages yet
        </Text>
        <Text
          style={[
            styles.emptySubtext,
            { color: theme.emptySubtext ?? "#8E8E93" },
          ]}
        >
          Start the conversation!
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }, style]}>
      <FlatList
        ref={listRef}
        data={listItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        inverted={true}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        contentContainerStyle={[styles.listContent, contentContainerStyle]}
        keyboardDismissMode="on-drag"
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={10}
        ListFooterComponent={
          <>
            {isStale && (
              <View style={styles.staleBanner}>
                <Text
                  style={[
                    styles.staleText,
                    { color: theme.warningColor ?? "#FF9500" },
                  ]}
                >
                  Showing cached messages
                </Text>
              </View>
            )}
            {hasMore ? (
              <View style={styles.loadMoreContainer}>
                <ActivityIndicator size="small" color={accent} />
                <Text
                  style={[
                    styles.loadMoreText,
                    { color: theme.textSecondary ?? "#8E8E93" },
                  ]}
                >
                  Loading more messages...
                </Text>
              </View>
            ) : null}
          </>
        }
      />

      {showScrollToBottom && (
        <Pressable
          style={[styles.scrollToBottomButton, { backgroundColor: scrollBtnColor }]}
          onPress={handleScrollToBottom}
        >
          <Text style={styles.scrollToBottomIcon}>{"↓"}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 16,
    textAlign: "center",
  },
  loadMoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  loadMoreText: {
    fontSize: 14,
  },
  dateSeparatorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 16,
    paddingHorizontal: 16,
  },
  dateSeparatorLine: {
    flex: 1,
    height: 1,
  },
  dateSeparatorText: {
    fontSize: 12,
    fontWeight: "600",
    marginHorizontal: 12,
    textTransform: "uppercase",
  },
  scrollToBottomButton: {
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  scrollToBottomIcon: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
  },
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    gap: 6,
  },
  staleText: {
    fontSize: 12,
    fontWeight: "500",
  },
});
