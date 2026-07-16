/**
 * useSubscription — Query the current user's subscription status.
 *
 * Wraps a Convex query that returns subscription data from your backend.
 * The consumer app provides the query reference and arguments; this hook
 * normalizes the result into a standard UseSubscriptionResult.
 *
 * Adapted from Togather's billing getSubscriptionStatus query pattern.
 */

import { useMemo } from "react";
import type {
  Subscription,
  SubscriptionStatus,
  UseSubscriptionResult,
} from "../types/index.js";

/**
 * Shape of the raw data returned from a Convex subscription query.
 * This is intentionally loose to support different backend schemas.
 */
interface RawSubscriptionData {
  subscriptionStatus?: string | null;
  subscriptionPriceMonthly?: number | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  billingEmail?: string | null;
  status?: string | null;
  priceMonthly?: number | null;
}

/**
 * Hook to get the current subscription status.
 *
 * @param queryResult - The result from a `useQuery()` call to your subscription
 *   query. Pass `undefined` while loading, `null` if no subscription exists.
 *
 * @example
 * ```tsx
 * import { useQuery, api } from "../convex/_generated";
 * import { useSubscription } from "@supa-media/payments/hooks";
 *
 * function BillingPage({ communityId }: { communityId: string }) {
 *   const data = useQuery(api.billing.getSubscriptionStatus, {
 *     communityId,
 *   });
 *   const { isActive, isPastDue, subscription } = useSubscription(data);
 *
 *   if (isActive) return <ActiveView subscription={subscription} />;
 *   if (isPastDue) return <PastDueWarning />;
 *   return <SubscribePrompt />;
 * }
 * ```
 */
export function useSubscription(
  queryResult: RawSubscriptionData | null | undefined
): UseSubscriptionResult {
  return useMemo(() => {
    // Still loading
    if (queryResult === undefined) {
      return {
        subscription: null,
        isLoading: true,
        isActive: false,
        isPastDue: false,
        isCanceled: false,
        isTrialing: false,
      };
    }

    // No subscription
    if (queryResult === null) {
      return {
        subscription: null,
        isLoading: false,
        isActive: false,
        isPastDue: false,
        isCanceled: false,
        isTrialing: false,
      };
    }

    // Normalize the raw data — support both naming conventions
    const status = (queryResult.subscriptionStatus ??
      queryResult.status ??
      null) as SubscriptionStatus | null;

    const subscription: Subscription = {
      stripeSubscriptionId:
        queryResult.stripeSubscriptionId ?? null,
      stripeCustomerId: queryResult.stripeCustomerId ?? null,
      status,
      priceMonthly:
        queryResult.subscriptionPriceMonthly ??
        queryResult.priceMonthly ??
        null,
      billingEmail: queryResult.billingEmail ?? null,
    };

    return {
      subscription,
      isLoading: false,
      isActive: status === "active",
      isPastDue: status === "past_due",
      isCanceled: status === "canceled",
      isTrialing: status === "trialing",
    };
  }, [queryResult]);
}
