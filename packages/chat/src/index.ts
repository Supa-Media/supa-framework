/**
 * @supa-media/chat
 *
 * Production-grade real-time messaging for Supa apps.
 *
 * Built from Togather's battle-tested chat implementation with
 * cursor-based pagination, offline caching, optimistic sends,
 * and a pluggable adapter architecture.
 */

// Components
export { MessageList, MessageInput } from "./components";
export type {
  MessageListProps,
  MessageListTheme,
  RenderMessageProps,
  MessageInputProps,
  MessageInputTheme,
  ReplyTo,
} from "./components";

// Hooks
export { useMessages, useSendMessage, useChannels, useUnreadCount } from "./hooks";

// Stores
export {
  useMessageCache,
  createMessageCache,
  useChannelCache,
  createChannelCache,
  useInboxCache,
  createInboxCache,
  useOfflineQueue,
} from "./stores";

// Adapters
export { ConvexChatAdapter } from "./adapters";
export type { ChatAdapter } from "./adapters";

// Types
export type {
  Message,
  MessageContentType,
  Attachment,
  OptimisticMessage,
  OptimisticStatus,
  Channel,
  SendMessageOptions,
  ChatConfig,
  PaginatedMessagesResult,
  UseMessagesResult,
  UseSendMessageResult,
} from "./types";
export { DEFAULT_CHAT_CONFIG } from "./types";
