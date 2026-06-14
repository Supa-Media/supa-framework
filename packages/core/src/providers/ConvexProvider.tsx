"use client";

import React, { useCallback, type ReactNode } from "react";
import { Platform, View, Text } from "react-native";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import type { TokenStorage } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";

/**
 * Platform-aware secure token storage.
 *
 * - Native (iOS/Android): uses `expo-secure-store` for encrypted keychain storage.
 * - Web: falls back to `localStorage`.
 */
const secureStorage: TokenStorage = {
  getItem(key: string) {
    if (Platform.OS === "web") {
      return localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  setItem(key: string, value: string) {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    return SecureStore.setItemAsync(key, value);
  },
  removeItem(key: string) {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    return SecureStore.deleteItemAsync(key);
  },
};

export interface SupaConvexProviderProps {
  children: ReactNode;
  /**
   * The Convex deployment URL. If not provided, reads from
   * `EXPO_PUBLIC_CONVEX_URL` environment variable.
   */
  url?: string;
  /**
   * Custom token storage implementation. Defaults to platform-aware
   * secure storage (SecureStore on native, localStorage on web).
   */
  storage?: TokenStorage;
}

// Module-level client singleton, lazily initialized
let _client: ConvexReactClient | null = null;
let _clientUrl: string | null = null;

function getClient(url: string): ConvexReactClient {
  if (_client && _clientUrl === url) return _client;
  _client = new ConvexReactClient(url);
  _clientUrl = url;
  return _client;
}

/**
 * Dependency-free full-screen config error. Rendered (instead of throwing) in
 * production builds so a missing build-time env var surfaces as a readable
 * message rather than an opaque expo-updates crash.
 */
function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#ffffff",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
      }}
    >
      <Text
        style={{
          fontSize: 20,
          fontWeight: "700",
          color: "#b91c1c",
          marginBottom: 12,
        }}
      >
        Configuration error
      </Text>
      <Text
        style={{
          fontSize: 15,
          color: "#374151",
          textAlign: "center",
          lineHeight: 22,
        }}
      >
        {message}
      </Text>
    </View>
  );
}

/**
 * Wraps the app with Convex authentication context.
 *
 * Handles:
 * - JWT token storage (SecureStore on native, localStorage on web)
 * - Automatic token refresh
 * - Auth state synchronization with the Convex backend
 * - Magic link callback code handling (web)
 *
 * @example
 * ```tsx
 * // app/_layout.tsx
 * import { SupaConvexProvider } from '@supa-media/core/providers';
 *
 * export default function RootLayout() {
 *   return (
 *     <SupaConvexProvider>
 *       <Slot />
 *     </SupaConvexProvider>
 *   );
 * }
 * ```
 */
export function SupaConvexProvider({
  children,
  url,
  storage,
}: SupaConvexProviderProps) {
  const convexUrl = url ?? process.env.EXPO_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    // `EXPO_PUBLIC_*` vars are inlined at BUILD/EXPORT time, so the #1 cause is
    // forgetting to set EXPO_PUBLIC_CONVEX_URL for `eas build` AND `eas update`
    // (not just locally / on the web deploy).
    const message =
      "Missing Convex URL.\n\n" +
      "Pass `url` to <SupaConvexProvider>, or set EXPO_PUBLIC_CONVEX_URL.\n\n" +
      "Note: EXPO_PUBLIC_* vars are baked in at build/export time — they must be " +
      "present for `eas build` AND `eas update`, not only in local dev.";
    // Loud in development (red-box). In production we render a visible diagnostic
    // instead of throwing, because an unhandled throw at startup is swallowed by
    // expo-updates' ErrorRecovery into an opaque native crash (SIGABRT).
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      throw new Error(message.replace(/\n+/g, " "));
    }
    console.error("[SupaConvexProvider] " + message.replace(/\n+/g, " "));
    return <ConfigErrorScreen message={message} />;
  }

  const client = getClient(convexUrl);

  /**
   * After a magic link callback, remove the `code` param from the URL
   * so it doesn't linger in the address bar.
   *
   * Uses `window.history.replaceState` instead of router.replace to avoid
   * "Attempted to navigate before mounting the Root Layout" errors.
   */
  const replaceURL = useCallback((relativeUrl: string) => {
    if (Platform.OS === "web") {
      window.history.replaceState(null, "", relativeUrl);
    }
  }, []);

  return (
    <ConvexAuthProvider
      client={client}
      storage={storage ?? secureStorage}
      replaceURL={replaceURL}
    >
      {children}
    </ConvexAuthProvider>
  );
}
