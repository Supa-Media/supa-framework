/**
 * @supa-media/core - Runtime core for the Supa framework.
 *
 * Provides providers, hooks, navigation components, and form utilities
 * for building Convex + Expo applications.
 *
 * @packageDocumentation
 */

// Config
export {
  defineConfig,
  loadConfig,
  type SupaConfig,
  type AuthConfig,
  type TenancyConfig,
  type MobileConfig,
  type FeaturesConfig,
  type BuildConfig,
  type SecretsConfig,
  type DeployConfig,
  type PaymentsConfig,
  type DevConfig,
  type SharedConfig,
  type ConvexConfig,
} from "./config";

// Providers
export {
  SupaConvexProvider,
  OTAUpdateProvider,
  ErrorBoundary,
  KeyboardProvider,
  NetworkProvider,
  type SupaConvexProviderProps,
  type OTAStatus,
  type OTAUpdateContextType,
  type OTAUpdateProviderProps,
  type ErrorBoundaryProps,
  type KeyboardState,
  type KeyboardProviderProps,
  type NetworkStatus,
  type NetworkProviderProps,
} from "./providers";

// Hooks
export { useOTAStatus, useNetworkStatus, useKeyboardAware } from "./hooks";

// Navigation
export {
  SupaModal,
  SupaTabBar,
  type SupaModalProps,
  type SupaTabBarProps,
} from "./navigation";

// Forms
export {
  KeyboardAwareFormContainer,
  type KeyboardAwareFormContainerProps,
} from "./forms";
