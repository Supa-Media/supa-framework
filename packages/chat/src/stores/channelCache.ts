/**
 * Channel Cache Store
 *
 * Zustand store with AsyncStorage persistence for offline channel list access.
 * Provides stale-while-revalidate pattern for group channel lists.
 *
 * Copied from Togather's battle-tested channelsCache.ts, made generic.
 *
 * - Zeros `unreadCount` on each channel before storing to avoid stale badge counts
 * - 24 hour expiry (configurable)
 * - Max 50 groups, evict oldest (configurable)
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_CHAT_CONFIG } from "../types/index.js";
import type { ChatConfig, Channel } from "../types/index.js";

const MAX_GROUPS_DEFAULT = 50;

interface CachedChannels {
  channels: Channel[];
  timestamp: number;
}

interface ChannelCacheState {
  groups: Record<string, CachedChannels>;
  setGroupChannels: (groupId: string, channels: Channel[]) => void;
  getGroupChannels: (groupId: string) => Channel[] | null;
  clearAll: () => void;
}

function evictOldest(
  groups: Record<string, CachedChannels>,
  maxGroups: number
): Record<string, CachedChannels> {
  const entries = Object.entries(groups);
  if (entries.length <= maxGroups) return groups;

  const sorted = entries.sort(
    ([, a], [, b]) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
  );
  const toRemove = sorted.slice(0, entries.length - maxGroups);
  const result = { ...groups };
  toRemove.forEach(([key]) => delete result[key]);
  return result;
}

/**
 * Create a channel cache store with custom configuration.
 */
export function createChannelCache(config?: ChatConfig & { maxGroups?: number }) {
  const expiryMs = config?.cacheExpiryMs ?? DEFAULT_CHAT_CONFIG.cacheExpiryMs;
  const maxGroups = config?.maxGroups ?? MAX_GROUPS_DEFAULT;

  return create<ChannelCacheState>()(
    persist(
      (set, get) => ({
        groups: {},

        setGroupChannels: (groupId: string, channels: Channel[]) => {
          // Zero out unread counts before caching to avoid stale badges
          const sanitized = channels.map((ch) => ({
            ...ch,
            unreadCount: 0,
          }));

          set((state) => {
            const groups = evictOldest(
              {
                ...state.groups,
                [groupId]: {
                  channels: sanitized,
                  timestamp: Date.now(),
                },
              },
              maxGroups
            );
            return { groups };
          });
        },

        getGroupChannels: (groupId: string) => {
          const cached = get().groups[groupId];
          if (!cached) return null;
          if (Date.now() - cached.timestamp > expiryMs) return null;
          return cached.channels;
        },

        clearAll: () => {
          set({ groups: {} });
        },
      }),
      {
        name: "supa-channels-cache",
        storage: createJSONStorage(() => AsyncStorage),
        partialize: (state) => ({ groups: state.groups }),
      }
    )
  );
}

/** Default channel cache instance */
export const useChannelCache = createChannelCache();
