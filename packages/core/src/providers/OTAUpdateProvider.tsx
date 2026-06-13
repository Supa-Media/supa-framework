/**
 * OTAUpdateProvider - Non-blocking over-the-air update provider.
 *
 * Always renders children immediately and checks for updates in the background.
 *
 * State machine:
 *   idle -> checking -> downloading -> ready | error | idle
 *
 * When an update is ready and the app is backgrounded for 30+ seconds,
 * it auto-applies the update on next foreground via `Updates.reloadAsync()`.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

export type OTAStatus = "idle" | "checking" | "downloading" | "ready" | "error";

export interface OTAUpdateContextType {
  /** Current update status */
  status: OTAStatus;
  /** Manually trigger an update check */
  checkForUpdates: () => Promise<void>;
}

const OTAUpdateContext = createContext<OTAUpdateContextType>({
  status: "idle",
  checkForUpdates: async () => {},
});

/**
 * Returns the current OTA update status and a function to manually trigger
 * an update check.
 */
export const useOTAStatus = () => useContext(OTAUpdateContext);

/** Error codes that indicate a non-critical / expected condition */
const SILENT_ERROR_CODES = [
  "ERR_NOT_COMPATIBLE",
  "ERR_UPDATES_DISABLED",
  "ERR_UPDATES_NOT_INITIALIZED",
];

function isSilentError(error: any): boolean {
  if (SILENT_ERROR_CODES.includes(error?.code)) return true;
  const message: string = error?.message ?? "";
  return (
    message.includes("not supported") ||
    message.includes("Updates is not enabled")
  );
}

/** How long the app must be backgrounded before auto-applying an update */
const BACKGROUND_RELOAD_DELAY_MS = 30_000;
/** Maximum time to wait for an update download */
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** How long to show error status before auto-dismissing */
const ERROR_DISMISS_MS = 5_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), ms),
    ),
  ]);
}

export interface OTAUpdateProviderProps {
  children: ReactNode;
  /**
   * Called when an update check encounters an error.
   * Use this to report to your error tracking service.
   */
  onError?: (error: Error) => void;
}

/**
 * Provides background OTA update checking for Expo apps.
 *
 * In development mode (`__DEV__`), update checks are skipped entirely.
 *
 * @example
 * ```tsx
 * import { OTAUpdateProvider } from '@supa-media/core/providers';
 *
 * export default function RootLayout() {
 *   return (
 *     <OTAUpdateProvider onError={(e) => Sentry.captureException(e)}>
 *       <Slot />
 *     </OTAUpdateProvider>
 *   );
 * }
 * ```
 */
export function OTAUpdateProvider({ children, onError }: OTAUpdateProviderProps) {
  const [status, setStatus] = useState<OTAStatus>("idle");

  const backgroundedAtRef = useRef<number | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const checkForUpdates = useCallback(async () => {
    setStatus("checking");

    try {
      const checkResult = await Updates.checkForUpdateAsync();

      if (checkResult.isAvailable) {
        setStatus("downloading");

        try {
          const fetchResult = await withTimeout(
            Updates.fetchUpdateAsync(),
            DOWNLOAD_TIMEOUT_MS,
            "OTA download timed out",
          );

          if (fetchResult.isNew) {
            setStatus("ready");
            return;
          }
        } catch (downloadError: any) {
          // Download failures are non-fatal — user keeps running current version
          setStatus("idle");
          return;
        }
      }

      setStatus("idle");
    } catch (error: any) {
      if (isSilentError(error)) {
        setStatus("idle");
        return;
      }

      onError?.(error);
      setStatus("error");

      // Auto-dismiss error state
      setTimeout(() => {
        setStatus((current) => (current === "error" ? "idle" : current));
      }, ERROR_DISMISS_MS);
    }
  }, [onError]);

  // Check for updates on mount (skip in dev)
  useEffect(() => {
    if (__DEV__) {
      setStatus("idle");
      return;
    }
    checkForUpdates();
  }, [checkForUpdates]);

  // Auto-apply update when app is backgrounded 30+ seconds with an update ready.
  // Uses timestamp comparison because JS timers are suspended when the app is
  // backgrounded on iOS/Android.
  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextAppState: string) => {
        if (nextAppState === "background" && statusRef.current === "ready") {
          backgroundedAtRef.current = Date.now();
        } else if (nextAppState === "active") {
          const backgroundedAt = backgroundedAtRef.current;
          backgroundedAtRef.current = null;

          if (
            backgroundedAt &&
            statusRef.current === "ready" &&
            Date.now() - backgroundedAt >= BACKGROUND_RELOAD_DELAY_MS
          ) {
            Updates.reloadAsync().catch(() => {
              // Reload failure is non-fatal — user keeps running current version
            });
          }
        }
      },
    );

    return () => subscription.remove();
  }, []);

  return (
    <OTAUpdateContext.Provider value={{ status, checkForUpdates }}>
      {children}
    </OTAUpdateContext.Provider>
  );
}
