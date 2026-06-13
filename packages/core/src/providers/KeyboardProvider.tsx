/**
 * KeyboardProvider - App-wide keyboard state tracking.
 *
 * Provides keyboard height, visibility, and a computed safe bottom inset
 * that accounts for both the keyboard and the device safe area.
 *
 * Platform behavior:
 * - iOS: keyboard events report full height; safe area inset is subtracted
 *   to avoid double-padding.
 * - Android: `windowSoftInputMode="adjustResize"` handles most cases; this
 *   provider supplements with explicit height tracking.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface KeyboardState {
  /** Current keyboard height in points (0 when hidden) */
  keyboardHeight: number;
  /** Whether the keyboard is currently visible */
  keyboardVisible: boolean;
  /**
   * Safe bottom inset — the maximum of the keyboard height and the
   * device safe area bottom inset. Use this for bottom padding to
   * ensure content is never obscured.
   */
  bottomInset: number;
}

const KeyboardContext = createContext<KeyboardState>({
  keyboardHeight: 0,
  keyboardVisible: false,
  bottomInset: 0,
});

/**
 * Returns the current keyboard state including height, visibility,
 * and a computed bottom inset.
 */
export const useKeyboardAware = () => useContext(KeyboardContext);

export interface KeyboardProviderProps {
  children: ReactNode;
}

/**
 * Tracks keyboard state and provides it via React context.
 *
 * Must be rendered inside a `SafeAreaProvider`.
 *
 * @example
 * ```tsx
 * import { KeyboardProvider } from '@supa-media/core/providers';
 * import { SafeAreaProvider } from 'react-native-safe-area-context';
 *
 * <SafeAreaProvider>
 *   <KeyboardProvider>
 *     <App />
 *   </KeyboardProvider>
 * </SafeAreaProvider>
 * ```
 */
export function KeyboardProvider({ children }: KeyboardProviderProps) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const handleKeyboardShow = useCallback(
    (event: { endCoordinates: { height: number } }) => {
      const height = event.endCoordinates.height;
      setKeyboardHeight(height);
      setKeyboardVisible(true);
    },
    [],
  );

  const handleKeyboardHide = useCallback(() => {
    setKeyboardHeight(0);
    setKeyboardVisible(false);
  }, []);

  useEffect(() => {
    // iOS fires `will` events; Android fires `did` events
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [handleKeyboardShow, handleKeyboardHide]);

  // On iOS, the keyboard height includes the safe area bottom inset,
  // so we use the raw keyboard height. On Android, we take the max.
  const effectiveKeyboardHeight =
    Platform.OS === "ios" && keyboardVisible
      ? keyboardHeight - insets.bottom
      : keyboardHeight;

  const bottomInset = Math.max(
    effectiveKeyboardHeight > 0 ? effectiveKeyboardHeight : 0,
    insets.bottom,
  );

  return (
    <KeyboardContext.Provider
      value={{
        keyboardHeight: effectiveKeyboardHeight > 0 ? effectiveKeyboardHeight : 0,
        keyboardVisible,
        bottomInset,
      }}
    >
      {children}
    </KeyboardContext.Provider>
  );
}
