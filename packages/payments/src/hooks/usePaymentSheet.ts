/**
 * usePaymentSheet — Stripe payment sheet integration for React Native.
 *
 * Wraps @stripe/stripe-react-native's useStripe() to provide a clean
 * interface for initializing and presenting the Stripe Payment Sheet.
 *
 * This hook is designed for mobile apps using the native Stripe SDK.
 * For web-based checkout, use Stripe Checkout (redirect) instead.
 *
 * Note: The consumer app must have @stripe/stripe-react-native installed
 * and wrap their root layout in <StripeProvider>. This hook re-exports
 * the useStripe() functions with a simpler API and loading states.
 */

import { useState, useCallback } from "react";
import type { UsePaymentSheetResult } from "../types";

/**
 * Hook for presenting the Stripe Payment Sheet on mobile.
 *
 * Requires @stripe/stripe-react-native to be installed and the
 * StripeProvider to be configured in your app's root layout.
 *
 * @param stripe - The return value of useStripe() from @stripe/stripe-react-native.
 *   We accept it as a parameter rather than calling useStripe() internally,
 *   since the Stripe SDK may not be installed (it's an optional peer dep).
 *
 * @example
 * ```tsx
 * import { useStripe } from "@stripe/stripe-react-native";
 * import { usePaymentSheet } from "@supa-media/payments/hooks";
 *
 * function CheckoutButton({ clientSecret }: { clientSecret: string }) {
 *   const stripe = useStripe();
 *   const { initialize, openPaymentSheet, isReady, isPresenting } =
 *     usePaymentSheet(stripe);
 *
 *   useEffect(() => {
 *     initialize(clientSecret);
 *   }, [clientSecret]);
 *
 *   return (
 *     <Button
 *       onPress={async () => {
 *         const { error } = await openPaymentSheet();
 *         if (!error) {
 *           // Payment succeeded
 *         }
 *       }}
 *       disabled={!isReady || isPresenting}
 *     >
 *       Pay Now
 *     </Button>
 *   );
 * }
 * ```
 */
export function usePaymentSheet(
  stripe?: {
    initPaymentSheet: (params: {
      paymentIntentClientSecret: string;
      merchantDisplayName: string;
    }) => Promise<{ error?: { message: string } }>;
    presentPaymentSheet: () => Promise<{
      error?: { message: string };
    }>;
  } | null
): UsePaymentSheetResult {
  const [isPresenting, setIsPresenting] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const initialize = useCallback(
    async (clientSecret: string) => {
      if (!stripe) {
        // eslint-disable-next-line no-console
        console.warn(
          "[@supa-media/payments] No Stripe instance provided to usePaymentSheet. " +
            "Pass the result of useStripe() from @stripe/stripe-react-native."
        );
        return;
      }

      const { error } = await stripe.initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: "Payment",
      });

      if (error) {
        // eslint-disable-next-line no-console
        console.error(
          "[@supa-media/payments] Failed to initialize payment sheet:",
          error.message
        );
        return;
      }

      setIsReady(true);
    },
    [stripe]
  );

  const openPaymentSheet = useCallback(async (): Promise<{
    error?: string;
  }> => {
    if (!stripe) {
      return { error: "No Stripe instance provided to usePaymentSheet" };
    }

    setIsPresenting(true);
    try {
      const { error } = await stripe.presentPaymentSheet();
      if (error) {
        return { error: error.message };
      }
      return {};
    } finally {
      setIsPresenting(false);
    }
  }, [stripe]);

  return {
    openPaymentSheet,
    isPresenting,
    isReady,
    initialize,
  };
}
