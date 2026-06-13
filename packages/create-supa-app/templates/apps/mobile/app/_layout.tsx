import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SupaConvexProvider } from "@supa-media/core/providers";
{{PROVIDER_IMPORTS}}

/**
 * Root layout for {{APP_NAME}}.
 *
 * `SupaConvexProvider` provides both the Convex client and auth context
 * (it wraps @convex-dev/auth's ConvexAuthProvider with platform-aware secure
 * token storage). Route groups under `(app)` and `(auth)` handle gating.
 *
 * The Convex URL is passed explicitly from app code: Expo only inlines
 * `EXPO_PUBLIC_*` env vars in app code, NOT inside node_modules (where
 * @supa-media/core lives), so the provider can't read it on its own.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SupaConvexProvider url={process.env.EXPO_PUBLIC_CONVEX_URL}>
{{PROVIDER_OPEN}}
        <StatusBar style="auto" />
        <Slot />
{{PROVIDER_CLOSE}}
      </SupaConvexProvider>
    </SafeAreaProvider>
  );
}
