/**
 * NetworkProvider - Network connectivity monitoring.
 *
 * Wraps `@react-native-community/netinfo` in a React context with
 * debounced state transitions to avoid UI flicker during brief
 * connectivity changes.
 *
 * State machine:
 *   connecting -> connected (initial connection established)
 *   connected -> disconnected (after debounce period)
 *   disconnected -> connected (immediate on reconnect)
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import NetInfo from "@react-native-community/netinfo";

export interface NetworkStatus {
  /** Whether the device has network connectivity */
  isConnected: boolean;
  /** Whether the internet is actually reachable (not just WiFi connected) */
  isInternetReachable: boolean;
  /** Network connection type (wifi, cellular, ethernet, etc.) */
  connectionType: string;
  /** True during initial connectivity check */
  isInitializing: boolean;
}

const NetworkContext = createContext<NetworkStatus>({
  isConnected: true,
  isInternetReachable: true,
  connectionType: "unknown",
  isInitializing: true,
});

/**
 * Returns the current network connectivity status.
 */
export const useNetworkStatus = () => useContext(NetworkContext);

/** Debounce period before reporting disconnection */
const DISCONNECT_DEBOUNCE_MS = 2_000;

export interface NetworkProviderProps {
  children: ReactNode;
}

/**
 * Monitors network connectivity and provides status via React context.
 *
 * Uses `@react-native-community/netinfo` under the hood. Includes a
 * 2-second debounce before reporting disconnection to avoid flicker
 * during brief network interruptions.
 *
 * @example
 * ```tsx
 * import { NetworkProvider } from '@supa-media/core/providers';
 *
 * <NetworkProvider>
 *   <App />
 * </NetworkProvider>
 *
 * // In a child component:
 * const { isConnected } = useNetworkStatus();
 * ```
 */
export function NetworkProvider({ children }: NetworkProviderProps) {
  const [isConnected, setIsConnected] = useState(true);
  const [isInternetReachable, setIsInternetReachable] = useState(true);
  const [connectionType, setConnectionType] = useState("unknown");
  const [isInitializing, setIsInitializing] = useState(true);

  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected ?? false;
      const reachable = state.isInternetReachable ?? true;

      setConnectionType(state.type ?? "unknown");
      setIsInitializing(false);

      if (!connected || !reachable) {
        // Debounce disconnection to avoid flicker
        if (!disconnectTimerRef.current) {
          disconnectTimerRef.current = setTimeout(() => {
            setIsConnected(connected);
            setIsInternetReachable(reachable);
            disconnectTimerRef.current = null;
          }, DISCONNECT_DEBOUNCE_MS);
        }
      } else {
        // Reconnection is immediate
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        setIsConnected(true);
        setIsInternetReachable(true);
      }
    });

    return () => {
      unsubscribe();
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
      }
    };
  }, []);

  return (
    <NetworkContext.Provider
      value={{ isConnected, isInternetReachable, connectionType, isInitializing }}
    >
      {children}
    </NetworkContext.Provider>
  );
}
