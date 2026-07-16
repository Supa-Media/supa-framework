/**
 * Offline Send Queue
 *
 * Zustand store that queues outgoing messages when the device is offline.
 * Messages are automatically flushed when the connection restores.
 *
 * Derived from Togather's useConvexSendMessage offline queue, extracted
 * into a standalone store for reuse across components and hooks.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SendMessageOptions } from "../types/index.js";

interface QueuedMessage {
  id: string;
  channelId: string;
  content: string;
  options?: SendMessageOptions;
  queuedAt: number;
}

interface OfflineQueueState {
  queue: QueuedMessage[];
  enqueue: (channelId: string, content: string, options?: SendMessageOptions) => string;
  dequeue: (id: string) => void;
  peek: () => QueuedMessage | undefined;
  drain: () => QueuedMessage[];
  clear: () => void;
  size: () => number;
}

let counter = 0;

export const useOfflineQueue = create<OfflineQueueState>()(
  persist(
    (set, get) => ({
      queue: [],

      enqueue: (channelId: string, content: string, options?: SendMessageOptions) => {
        const id = `offline-${Date.now()}-${counter++}`;
        const item: QueuedMessage = {
          id,
          channelId,
          content,
          options,
          queuedAt: Date.now(),
        };
        set((state) => ({ queue: [...state.queue, item] }));
        return id;
      },

      dequeue: (id: string) => {
        set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
      },

      peek: () => {
        return get().queue[0];
      },

      drain: () => {
        const items = get().queue;
        set({ queue: [] });
        return items;
      },

      clear: () => {
        set({ queue: [] });
      },

      size: () => {
        return get().queue.length;
      },
    }),
    {
      name: "supa-offline-queue",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ queue: state.queue }),
    }
  )
);
