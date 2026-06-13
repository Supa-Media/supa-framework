import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SupaConvexProvider } from "@supa/core";
{{PROVIDER_IMPORTS}}

/**
 * Root layout for {{APP_NAME}}.
 *
 * `SupaConvexProvider` provides both the Convex client and auth context
 * (it wraps @convex-dev/auth's ConvexAuthProvider with platform-aware secure
 * token storage). Route groups under `(app)` and `(auth)` handle gating.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SupaConvexProvider>
{{PROVIDER_OPEN}}
        <StatusBar style="auto" />
        <Slot />
{{PROVIDER_CLOSE}}
      </SupaConvexProvider>
    </SafeAreaProvider>
  );
}
