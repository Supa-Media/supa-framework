/**
 * KeyboardAwareFormContainer - Ensures form inputs are never hidden behind the keyboard.
 *
 * Built on `react-native-keyboard-controller` (the robust, cross-platform
 * keyboard library) rather than React Native's finicky `KeyboardAvoidingView`:
 * the focused input is smoothly scrolled above the keyboard on both iOS and
 * Android. Requires `<KeyboardProvider>` mounted at the app root (the scaffold
 * does this in app/_layout.tsx).
 */
import React, { type ReactNode } from "react";
import { StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import {
  KeyboardAwareScrollView,
  KeyboardAvoidingView,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface KeyboardAwareFormContainerProps {
  children: ReactNode;
  /**
   * Extra space kept between the focused input and the top of the keyboard.
   * @default 24
   */
  keyboardVerticalOffset?: number;
  /**
   * Whether to wrap children in a scroll view. Set to `false` if your content
   * already includes its own ScrollView/FlatList.
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
  keyboardVerticalOffset = 24,
  scrollable = true,
  style,
  contentContainerStyle,
  safeAreaBottom = true,
}: KeyboardAwareFormContainerProps) {
  const insets = useSafeAreaInsets();

  // Caller owns its own scroll view — just avoid the keyboard, don't add a scroll.
  if (!scrollable) {
    return (
      <KeyboardAvoidingView
        style={[styles.container, style]}
        behavior="padding"
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={[styles.container, style]}
      bottomOffset={keyboardVerticalOffset}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.scrollContent,
        safeAreaBottom && { paddingBottom: insets.bottom + 16 },
        contentContainerStyle,
      ]}
    >
      {children}
    </KeyboardAwareScrollView>
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
