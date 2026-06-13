/**
 * KeyboardAwareFormContainer - Ensures form inputs are never hidden behind the keyboard.
 *
 * Platform behavior:
 * - iOS: Uses `KeyboardAvoidingView` with `behavior="padding"` to push content up.
 * - Android: Uses `behavior="height"` since `adjustResize` sometimes doesn't cover
 *   all cases (e.g., fullscreen modals, nested ScrollViews).
 *
 * Handles nested ScrollViews gracefully by wrapping content in a ScrollView
 * that adjusts its content inset.
 */
import React, { type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface KeyboardAwareFormContainerProps {
  children: ReactNode;
  /**
   * Extra offset to add above the keyboard (e.g., for a sticky bottom button).
   * @default 0
   */
  keyboardVerticalOffset?: number;
  /**
   * Whether to wrap children in a ScrollView. Set to `false` if your
   * content already includes a ScrollView.
   * @default true
   */
  scrollable?: boolean;
  /** Custom style for the outer container */
  style?: StyleProp<ViewStyle>;
  /** Custom style for the ScrollView content container */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Whether to add bottom safe area padding.
   * @default true
   */
  safeAreaBottom?: boolean;
}

/**
 * Wraps form content with keyboard-aware behavior.
 *
 * @example
 * ```tsx
 * import { KeyboardAwareFormContainer } from '@supa-media/core/forms';
 *
 * function CreatePostScreen() {
 *   return (
 *     <KeyboardAwareFormContainer keyboardVerticalOffset={80}>
 *       <TextInput placeholder="Title" />
 *       <TextInput placeholder="Body" multiline />
 *       <Button title="Submit" />
 *     </KeyboardAwareFormContainer>
 *   );
 * }
 * ```
 */
export function KeyboardAwareFormContainer({
  children,
  keyboardVerticalOffset = 0,
  scrollable = true,
  style,
  contentContainerStyle,
  safeAreaBottom = true,
}: KeyboardAwareFormContainerProps) {
  const insets = useSafeAreaInsets();

  // iOS: "padding" pushes content up smoothly.
  // Android: "height" resizes the view, which works better with adjustResize.
  const behavior = Platform.OS === "ios" ? "padding" : "height";

  // On iOS, add the safe area top as offset so the view doesn't over-shift
  // when presented inside a navigation stack.
  const defaultOffset = Platform.OS === "ios" ? insets.top : 0;
  const totalOffset = defaultOffset + keyboardVerticalOffset;

  const content = scrollable ? (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContent,
        safeAreaBottom && { paddingBottom: insets.bottom + 16 },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bounces={Platform.OS === "ios"}
    >
      {children}
    </ScrollView>
  ) : (
    children
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, style]}
      behavior={behavior}
      keyboardVerticalOffset={totalOffset}
    >
      {content}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
  },
});
