/**
 * Message Cache Store
 *
 * Zustand store with AsyncStorage persistence for offline message access.
 * Provides stale-while-revalidate pattern for chat messages.
 *
 * Copied from Togather's battle-tested implementation, made configurable.
 *
 * Limits (configurable via createMessageCache):
 * - 50 messages per channel (default)
 * - 20 channels total (default)
 * - 24 hour expiry (default)
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_CHAT_CONFIG } from "../types/index.js";
import type { ChatConfig, Message } from "../types/index.js";

interface CachedChannel {
  messages: Message[];
  timestamp: number;
}

interface MessageCacheState {
  channels: Record<string, CachedChannel>;
  setChannelMessages: (channelId: string, messages: Message[]) => void;
  getChannelMessages: (channelId: string) => Message[] | null;
  clearChannel: (channelId: string) => void;
  clearAll: () => void;
}

/**
 * Create a message cache store with custom configuration.
 *
 * @example
 * ```ts
 * const useMessageCache = createMessageCache({ maxMessagesPerChannel: 100 });
 * ```
 */
export function createMessageCache(config?: ChatConfig) {
  const maxMessages = config?.maxMessagesPerChannel ?? DEFAULT_CHAT_CONFIG.maxMessagesPerChannel;
  const maxChannels = config?.maxCachedChannels ?? DEFAULT_CHAT_CONFIG.maxCachedChannels;
  const expiryMs = config?.cacheExpiryMs ?? DEFAULT_CHAT_CONFIG.cacheExpiryMs;

  return create<MessageCacheState>()(
    persist(
      (set, get) => ({
        channels: {},

        setChannelMessages: (channelId: string, messages: Message[]) => {
          set((state) => {
            const channels = { ...state.channels };

            // Limit messages per channel (keep most recent)
            const limitedMessages =
              messages.length > maxMessages
                ? messages.slice(-maxMessages)
                : messages;

            channels[channelId] = {
              messages: limitedMessages,
              timestamp: Date.now(),
            };

            // Limit total channels (evict oldest)
            const channelIds = Object.keys(channels);
            if (channelIds.length > maxChannels) {
              // Sort by timestamp, remove oldest
              const sorted = channelIds.sort(
                (a, b) =>
                  (channels[a]?.timestamp ?? 0) - (channels[b]?.timestamp ?? 0)
              );
              const toRemove = sorted.slice(
                0,
                channelIds.length - maxChannels
              );
              toRemove.forEach((id) => delete channels[id]);
            }

            return { channels };
          });
        },

        getChannelMessages: (channelId: string) => {
          const cached = get().channels[channelId];
          if (!cached) return null;

          // Check expiry
          if (Date.now() - cached.timestamp > expiryMs) {
            return null;
          }

          return cached.messages;
        },

        clearChannel: (channelId: string) => {
          set((state) => {
            const channels = { ...state.channels };
            delete channels[channelId];
            return { channels };
          });
        },

        clearAll: () => {
          set({ channels: {} });
        },
      }),
      {
        name: "supa-message-cache",
        storage: createJSONStorage(() => AsyncStorage),
        partialize: (state) => ({ channels: state.channels }),
      }
    )
  );
}

/** Default message cache instance */
export const useMessageCache = createMessageCache();
