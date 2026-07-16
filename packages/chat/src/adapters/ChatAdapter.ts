/**
 * ChatAdapter — Backend-agnostic interface for chat operations
 *
 * Implement this interface to connect any real-time backend (Convex, Firebase,
 * Supabase, custom WebSocket server, etc.) to the @supa-media/chat UI layer.
 *
 * The adapter is responsible for:
 * - Fetching paginated messages for a channel
 * - Sending messages
 * - Listing channels
 * - Tracking unread counts
 */

import type {
  Message,
  Channel,
  PaginatedMessagesResult,
  SendMessageOptions,
  Attachment,
} from "../types/index.js";

export interface ChatAdapter {
  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * Fetch messages for a channel with cursor-based pagination.
   *
   * @param channelId - Channel to fetch messages from
   * @param limit - Number of messages per page
   * @param cursor - Pagination cursor (undefined for the first/live page)
   * @returns Paginated messages result
   */
  getMessages(
    channelId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedMessagesResult> | PaginatedMessagesResult | undefined;

  /**
   * Subscribe to live message updates for a channel.
   * Returns an unsubscribe function.
   *
   * Not all adapters support subscriptions — return undefined if the adapter
   * relies on polling or if the hook layer handles subscriptions directly
   * (e.g., Convex useQuery).
   */
  subscribeMessages?(
    channelId: string,
    limit: number,
    onUpdate: (result: PaginatedMessagesResult) => void
  ): () => void;

  /**
   * Send a message to a channel.
   *
   * @param channelId - Target channel
   * @param content - Message text
   * @param options - Attachments, mentions, thread parent, etc.
   * @returns The server-assigned message ID
   */
  sendMessage(
    channelId: string,
    content: string,
    options?: SendMessageOptions
  ): Promise<string>;

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  /**
   * List channels the current user has access to, optionally scoped to a group.
   */
  getChannels(groupId?: string): Promise<Channel[]> | Channel[] | undefined;

  /**
   * Subscribe to channel list updates.
   * Returns an unsubscribe function, or undefined if not supported.
   */
  subscribeChannels?(
    groupId: string | undefined,
    onUpdate: (channels: Channel[]) => void
  ): () => void;

  // ---------------------------------------------------------------------------
  // Unread
  // ---------------------------------------------------------------------------

  /**
   * Get unread message count for a channel.
   */
  getUnreadCount?(channelId: string): Promise<number> | number | undefined;

  // ---------------------------------------------------------------------------
  // Auth context
  // ---------------------------------------------------------------------------

  /**
   * Current authenticated user ID. Used for optimistic messages and
   * determining which messages are "mine" in the UI.
   */
  getCurrentUserId(): string | null;

  /**
   * Current user display info for optimistic messages.
   */
  getCurrentUser(): { id: string; name: string; profilePhoto?: string } | null;
}
