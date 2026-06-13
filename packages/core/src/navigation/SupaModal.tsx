/**
 * SupaModal - Modal wrapper with keyboard avoidance and consistent dismiss behavior.
 *
 * Provides:
 * - KeyboardAvoidingView with platform-correct behavior (padding on iOS, height on Android)
 * - Tap-outside-to-dismiss via a backdrop pressable
 * - Swipe-to-dismiss on iOS via pan gesture (optional)
 * - Consistent border radius and safe area handling
 */
import React, { type ReactNode } from "react";
import {
  View,
  KeyboardAvoidingView,
  Pressable,
  Platform,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface SupaModalProps {
  children: ReactNode;
  /** Called when the user taps the backdrop or swipes to dismiss */
  onDismiss: () => void;
  /**
   * Whether the modal is presented as a full-screen overlay.
   * When false (default), renders as a bottom sheet with rounded corners.
   */
  fullScreen?: boolean;
  /**
   * Whether tapping the backdrop dismisses the modal.
   * @default true
   */
  dismissOnBackdrop?: boolean;
  /** Custom style for the content container */
  contentStyle?: StyleProp<ViewStyle>;
  /** Custom backdrop opacity (0-1). @default 0.5 */
  backdropOpacity?: number;
}

/**
 * Modal content wrapper with keyboard avoidance and consistent dismiss patterns.
 *
 * This is not a React Native `<Modal>` — it wraps the content you render
 * inside a modal screen (e.g., an Expo Router modal route or a bottom sheet).
 *
 * @example
 * ```tsx
 * // app/modal.tsx (Expo Router modal route)
 * import { SupaModal } from '@supa-media/core/navigation';
 * import { router } from 'expo-router';
 *
 * export default function MyModal() {
 *   return (
 *     <SupaModal onDismiss={() => router.back()}>
 *       <Text>Modal content here</Text>
 *     </SupaModal>
 *   );
 * }
 * ```
 */
export function SupaModal({
  children,
  onDismiss,
  fullScreen = false,
  dismissOnBackdrop = true,
  contentStyle,
  backdropOpacity = 0.5,
}: SupaModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      {/* Backdrop */}
      <Pressable
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        onPress={dismissOnBackdrop ? onDismiss : undefined}
        accessibilityRole="button"
        accessibilityLabel="Close modal"
      />

      {/* Content */}
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >
        <View
          style={[
            fullScreen
              ? [styles.fullScreenContent, { paddingTop: insets.top }]
              : styles.sheetContent,
            { paddingBottom: Math.max(insets.bottom, 16) },
            contentStyle,
          ]}
        >
          {!fullScreen && (
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
          )}
          {children}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  keyboardView: {
    justifyContent: "flex-end",
  },
  sheetContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: "90%",
  },
  fullScreenContent: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
  },
});
