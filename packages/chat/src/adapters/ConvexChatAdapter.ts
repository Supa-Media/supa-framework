/**
 * ConvexChatAdapter — Default adapter for Convex-backed chat
 *
 * Uses Convex queries/mutations for real-time messaging. This adapter is
 * designed to work with the standard Supa chat table schema:
 *
 *   chatChannels — channel metadata
 *   chatMessages — messages with cursor-based pagination
 *   chatChannelMembers — membership + unread tracking
 *
 * Since Convex's useQuery hook manages subscriptions at the React level,
 * the subscribe* methods are not implemented here — the hooks layer
 * (useMessages, useChannels) uses useQuery directly for reactivity.
 */

import type { ChatAdapter } from "./ChatAdapter.js";
import type {
  Message,
  Channel,
  PaginatedMessagesResult,
  SendMessageOptions,
} from "../types/index.js";

interface ConvexChatAdapterConfig {
  /**
   * Convex API reference object. Pass your generated `api` object, e.g.:
   *   import { api } from "../convex/_generated/api";
   */
  api: any;

  /**
   * Authenticated Convex client for imperative calls (actions/mutations
   * outside of React). For in-component use, hooks call useQuery/useMutation
   * directly with the api reference.
   */
  client: any;

  /**
   * Function to get the current auth token. Required for authenticated
   * Convex function calls.
   */
  getAuthToken: () => string | null;

  /**
   * Function to get the current user's ID.
   */
  getCurrentUserId: () => string | null;

  /**
   * Function to get the current user's display info.
   */
  getCurrentUser: () => { id: string; name: string; profilePhoto?: string } | null;

  /**
   * Namespace for Convex functions. Defaults to "functions.messaging.messages"
   * which maps to `api.functions.messaging.messages.getMessages`, etc.
   */
  functionNamespace?: {
    getMessages: any;
    sendMessage: any;
    listChannels?: any;
    getUnreadCount?: any;
  };
}

export class ConvexChatAdapter implements ChatAdapter {
  private config: ConvexChatAdapterConfig;

  constructor(config: ConvexChatAdapterConfig) {
    this.config = config;
  }

  async getMessages(
    channelId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedMessagesResult> {
    const token = this.config.getAuthToken();
    if (!token) {
      return { messages: [], hasMore: false };
    }

    const fn = this.config.functionNamespace?.getMessages;
    if (!fn) {
      throw new Error(
        "ConvexChatAdapter: getMessages function reference not configured"
      );
    }

    const result = await this.config.client.query(fn, {
      token,
      channelId,
      limit,
      cursor,
    });

    return {
      messages: (result?.messages ?? []) as Message[],
      hasMore: result?.hasMore ?? false,
      cursor: result?.cursor,
    };
  }

  async sendMessage(
    channelId: string,
    content: string,
    options?: SendMessageOptions
  ): Promise<string> {
    const token = this.config.getAuthToken();
    if (!token) {
      throw new Error("ConvexChatAdapter: not authenticated");
    }

    const fn = this.config.functionNamespace?.sendMessage;
    if (!fn) {
      throw new Error(
        "ConvexChatAdapter: sendMessage function reference not configured"
      );
    }

    const messageId = await this.config.client.mutation(fn, {
      token,
      channelId,
      content,
      attachments: options?.attachments,
      parentMessageId: options?.parentMessageId,
      mentionedUserIds: options?.mentionedUserIds,
      hideLinkPreview: options?.hideLinkPreview,
    });

    return messageId as string;
  }

  async getChannels(groupId?: string): Promise<Channel[]> {
    const token = this.config.getAuthToken();
    if (!token) return [];

    const fn = this.config.functionNamespace?.listChannels;
    if (!fn) return [];

    const result = await this.config.client.query(fn, {
      token,
      ...(groupId ? { groupId } : {}),
    });

    return (result ?? []) as Channel[];
  }

  async getUnreadCount(channelId: string): Promise<number> {
    const token = this.config.getAuthToken();
    if (!token) return 0;

    const fn = this.config.functionNamespace?.getUnreadCount;
    if (!fn) return 0;

    const result = await this.config.client.query(fn, {
      token,
      channelId,
    });

    return result ?? 0;
  }

  getCurrentUserId(): string | null {
    return this.config.getCurrentUserId();
  }

  getCurrentUser(): { id: string; name: string; profilePhoto?: string } | null {
    return this.config.getCurrentUser();
  }
}
