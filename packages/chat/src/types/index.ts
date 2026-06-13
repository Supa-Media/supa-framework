/**
 * @supa-media/chat — Type definitions
 *
 * Core types for the chat system. These are backend-agnostic; adapters
 * translate backend-specific shapes into these types.
 */

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface Message {
  _id: string;
  channelId: string;
  senderId: string;
  content: string;
  contentType: MessageContentType;
  createdAt: number;
  updatedAt?: number;
  editedAt?: number;
  isDeleted: boolean;
  deletedAt?: number;
  parentMessageId?: string;
  attachments?: Attachment[];
  mentionedUserIds?: string[];
  threadReplyCount?: number;
  /** Denormalized sender info for rendering without extra queries */
  senderName?: string;
  senderProfilePhoto?: string;
  /** Hide auto-generated link preview for this message */
  hideLinkPreview?: boolean;
}

export type MessageContentType = "text" | "image" | "file" | "video" | "audio" | "system";

export interface Attachment {
  type: string;
  url: string;
  name?: string;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  waveform?: number[];
  duration?: number;
}

// ---------------------------------------------------------------------------
// Optimistic messages (client-side only, before server confirms)
// ---------------------------------------------------------------------------

export type OptimisticStatus = "sending" | "sent" | "error" | "queued";

export interface OptimisticMessage extends Omit<Message, "_id"> {
  _id: string;
  _optimistic: true;
  _status: OptimisticStatus;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface Channel {
  _id: string;
  name: string;
  description?: string;
  channelType?: string;
  groupId?: string;
  createdAt: number;
  updatedAt?: number;
  memberCount?: number;
  unreadCount?: number;
  lastMessage?: {
    content: string;
    senderName?: string;
    createdAt: number;
  };
}

// ---------------------------------------------------------------------------
// Send options
// ---------------------------------------------------------------------------

export interface SendMessageOptions {
  attachments?: Attachment[];
  mentionedUserIds?: string[];
  parentMessageId?: string;
  hideLinkPreview?: boolean;
}

// ---------------------------------------------------------------------------
// Chat configuration
// ---------------------------------------------------------------------------

export interface ChatConfig {
  /** Max messages to cache per channel (default 50) */
  maxMessagesPerChannel?: number;
  /** Max channels to cache (default 20) */
  maxCachedChannels?: number;
  /** Cache expiry in ms (default 24 hours) */
  cacheExpiryMs?: number;
  /** Messages per page for pagination (default 20) */
  pageSize?: number;
}

export const DEFAULT_CHAT_CONFIG: Required<ChatConfig> = {
  maxMessagesPerChannel: 50,
  maxCachedChannels: 20,
  cacheExpiryMs: 24 * 60 * 60 * 1000, // 24 hours
  pageSize: 20,
};

// ---------------------------------------------------------------------------
// Adapter result shapes
// ---------------------------------------------------------------------------

export interface PaginatedMessagesResult {
  messages: Message[];
  hasMore: boolean;
  cursor?: string;
}

export interface UseMessagesResult {
  messages: Message[];
  loadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  isStale: boolean;
}

export interface UseSendMessageResult {
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>;
  optimisticMessages: OptimisticMessage[];
  isSending: boolean;
  retryMessage: (optimisticId: string) => Promise<void>;
  dismissMessage: (optimisticId: string) => void;
}
