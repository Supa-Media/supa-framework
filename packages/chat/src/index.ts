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
export { MessageList, MessageInput } from "./components/index.js";
export type {
  MessageListProps,
  MessageListTheme,
  RenderMessageProps,
  MessageInputProps,
  MessageInputTheme,
  ReplyTo,
} from "./components/index.js";

// Hooks
export { useMessages, useSendMessage, useChannels, useUnreadCount } from "./hooks/index.js";

// Stores
export {
  useMessageCache,
  createMessageCache,
  useChannelCache,
  createChannelCache,
  useInboxCache,
  createInboxCache,
  useOfflineQueue,
} from "./stores/index.js";

// Adapters
export { ConvexChatAdapter } from "./adapters/index.js";
export type { ChatAdapter } from "./adapters/index.js";

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
} from "./types/index.js";
export { DEFAULT_CHAT_CONFIG } from "./types/index.js";
