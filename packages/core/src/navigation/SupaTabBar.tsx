/**
 * SupaTabBar - Tab bar with safe area insets, keyboard dismiss, and badge support.
 *
 * Drop-in replacement for the default `@react-navigation/bottom-tabs` tab bar
 * with consistent safe area handling and keyboard dismissal on tab switch.
 */
import React, { useCallback } from "react";
import {
  View,
  Pressable,
  Text,
  Keyboard,
  StyleSheet,
  Platform,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

export interface SupaTabBarProps extends BottomTabBarProps {
  /** Custom style for the tab bar container */
  style?: StyleProp<ViewStyle>;
  /** Custom active tint color. @default "#1a1a1a" */
  activeTintColor?: string;
  /** Custom inactive tint color. @default "#9ca3af" */
  inactiveTintColor?: string;
}

/**
 * Custom tab bar component for `@react-navigation/bottom-tabs`.
 *
 * Features:
 * - Safe area bottom inset handling
 * - Keyboard dismissal when switching tabs
 * - Badge support via route options
 * - Consistent styling across platforms
 *
 * @example
 * ```tsx
 * import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
 * import { SupaTabBar } from '@supa-media/core/navigation';
 *
 * const Tab = createBottomTabNavigator();
 *
 * <Tab.Navigator tabBar={(props) => <SupaTabBar {...props} />}>
 *   <Tab.Screen name="Home" component={HomeScreen} />
 * </Tab.Navigator>
 * ```
 */
export function SupaTabBar({
  state,
  descriptors,
  navigation,
  style,
  activeTintColor = "#1a1a1a",
  inactiveTintColor = "#9ca3af",
}: SupaTabBarProps) {
  const insets = useSafeAreaInsets();

  const handleTabPress = useCallback(
    (route: (typeof state.routes)[number], isFocused: boolean) => {
      // Dismiss keyboard on tab switch
      Keyboard.dismiss();

      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    },
    [navigation],
  );

  const handleTabLongPress = useCallback(
    (route: (typeof state.routes)[number]) => {
      navigation.emit({
        type: "tabLongPress",
        target: route.key,
      });
    },
    [navigation],
  );

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 8) },
        style,
      ]}
    >
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const { options } = descriptor;
        const isFocused = state.index === index;
        const tintColor = isFocused ? activeTintColor : inactiveTintColor;

        const label =
          typeof options.tabBarLabel === "string"
            ? options.tabBarLabel
            : typeof options.title === "string"
              ? options.title
              : route.name;

        const badge = options.tabBarBadge;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarButtonTestID}
            onPress={() => handleTabPress(route, isFocused)}
            onLongPress={() => handleTabLongPress(route)}
            style={styles.tab}
          >
            <View style={styles.iconContainer}>
              {options.tabBarIcon?.({
                focused: isFocused,
                color: tintColor,
                size: 24,
              })}
              {badge != null && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {typeof badge === "number" && badge > 99 ? "99+" : badge}
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={[
                styles.label,
                { color: tintColor },
                isFocused && styles.labelActive,
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
  iconContainer: {
    position: "relative",
    marginBottom: 2,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 14,
  } as TextStyle,
  label: {
    fontSize: 10,
    lineHeight: 14,
  } as TextStyle,
  labelActive: {
    fontWeight: "600",
  } as TextStyle,
});
