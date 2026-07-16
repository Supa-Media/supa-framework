/**
 * Inbox Cache Store
 *
 * Zustand store with AsyncStorage persistence for offline inbox access.
 * Provides stale-while-revalidate pattern for the chat inbox channel list.
 *
 * Copied from Togather's battle-tested inboxCache.ts, made generic.
 *
 * - 24 hour expiry (configurable)
 * - Keyed by communityId / scope for multi-tenant support
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_CHAT_CONFIG } from "../types/index.js";
import type { ChatConfig, Channel } from "../types/index.js";

interface CachedInbox {
  channels: Channel[];
  timestamp: number;
}

interface InboxCacheState {
  scopes: Record<string, CachedInbox>;
  setInboxChannels: (scopeId: string, channels: Channel[]) => void;
  getInboxChannels: (scopeId: string) => Channel[] | null;
  clear: () => void;
}

/**
 * Create an inbox cache store with custom configuration.
 */
export function createInboxCache(config?: ChatConfig) {
  const expiryMs = config?.cacheExpiryMs ?? DEFAULT_CHAT_CONFIG.cacheExpiryMs;

  return create<InboxCacheState>()(
    persist(
      (set, get) => ({
        scopes: {},

        setInboxChannels: (scopeId: string, channels: Channel[]) => {
          set((state) => ({
            scopes: {
              ...state.scopes,
              [scopeId]: {
                channels,
                timestamp: Date.now(),
              },
            },
          }));
        },

        getInboxChannels: (scopeId: string) => {
          const cached = get().scopes[scopeId];
          if (!cached) return null;

          // Check expiry
          if (Date.now() - cached.timestamp > expiryMs) {
            return null;
          }

          return cached.channels;
        },

        clear: () => {
          set({ scopes: {} });
        },
      }),
      {
        name: "supa-inbox-cache",
        storage: createJSONStorage(() => AsyncStorage),
        partialize: (state) => ({ scopes: state.scopes }),
      }
    )
  );
}

/** Default inbox cache instance */
export const useInboxCache = createInboxCache();
