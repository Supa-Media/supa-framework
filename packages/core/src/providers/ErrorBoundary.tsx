import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Custom fallback UI to show when an error is caught.
   * Receives the error and a reset function.
   */
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
  /**
   * Called when an error is caught. Use this to report to your
   * error tracking service (Sentry, etc.).
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic React error boundary that catches render errors.
 *
 * Provides a default fallback UI with a retry button, or accepts
 * a custom `fallback` render function.
 *
 * @example
 * ```tsx
 * import { ErrorBoundary } from '@supa-media/core/providers';
 *
 * <ErrorBoundary
 *   onError={(error) => Sentry.captureException(error)}
 *   fallback={({ error, reset }) => (
 *     <View>
 *       <Text>Something went wrong: {error.message}</Text>
 *       <Button onPress={reset} title="Retry" />
 *     </View>
 *   )}
 * >
 *   <App />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (fallback) {
        return fallback({ error, reset: this.reset });
      }

      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{error.message}</Text>
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
    color: "#1a1a1a",
  },
  message: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },
});
