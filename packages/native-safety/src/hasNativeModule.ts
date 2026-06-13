/**
 * Runtime check for native module availability.
 *
 * Use this in safe wrapper components to detect whether a gated native
 * dependency is linked in the current native build. If the module isn't
 * available (e.g., on an older OTA build), the wrapper renders a fallback.
 *
 * Supports both architectures:
 * - Legacy bridge: checks NativeModules registry
 * - New architecture (Fabric/TurboModules): uses expo-modules-core requireNativeModule
 *
 * @example
 * ```ts
 * import { hasNativeModule } from '@supa-media/native-safety';
 *
 * export function isLinearGradientSupported(): boolean {
 *   if (!hasNativeModule('ExpoLinearGradient')) return false;
 *   try {
 *     const mod = require('expo-linear-gradient');
 *     return !!mod?.LinearGradient;
 *   } catch {
 *     return false;
 *   }
 * }
 * ```
 */

import { NativeModules, Platform } from 'react-native';

/**
 * Check if one or more native modules are registered in the current build.
 *
 * Accepts multiple names because some modules use different names on the
 * legacy bridge vs expo-modules-core (e.g., ExpoAV vs ExponentAV).
 *
 * Returns true if ANY of the provided module names are found.
 *
 * @param moduleNames - One or more native module names to check
 * @returns true if at least one module is available
 */
export function hasNativeModule(...moduleNames: string[]): boolean {
  // Legacy bridge check
  for (const name of moduleNames) {
    if (NativeModules[name]) return true;
  }

  // On web, native modules don't exist — skip expo-modules-core
  if (Platform.OS === 'web') {
    return false;
  }

  // New architecture (native only): try expo-modules-core's requireNativeModule
  try {
    const expoModulesCore = require('expo-modules-core');
    for (const name of moduleNames) {
      try {
        expoModulesCore.requireNativeModule(name);
        return true;
      } catch {
        // Module not found under this name, try next
      }
    }
  } catch {
    // expo-modules-core not available
  }

  return false;
}
