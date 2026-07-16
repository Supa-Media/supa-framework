/**
 * PaywallGate — Conditionally render content based on subscription status.
 *
 * Wraps premium features and shows a fallback (e.g., an upgrade screen)
 * when the user does not have an active subscription.
 *
 * @example
 * ```tsx
 * import { PaywallGate } from "@supa-media/payments/components";
 *
 * <PaywallGate
 *   subscription={subscriptionData}
 *   fallback={<UpgradeScreen />}
 *   loading={<LoadingSpinner />}
 * >
 *   <PremiumFeature />
 * </PaywallGate>
 * ```
 */

import type { ReactNode, ReactElement } from "react";
import type { SubscriptionStatus } from "../types/index.js";
import { useSubscription } from "../hooks/useSubscription.js";

const DEFAULT_ALLOWED_STATUSES: SubscriptionStatus[] = ["active", "trialing"];

interface PaywallGateProps {
  /** Content to show when the user has an active subscription */
  children: ReactNode;
  /** Content to show when the user does not have an active subscription */
  fallback: ReactNode;
  /**
   * Raw subscription query result. Passed directly to useSubscription().
   * Pass `undefined` while loading, `null` if no subscription.
   */
  subscription: Record<string, unknown> | null | undefined;
  /**
   * Subscription statuses that grant access.
   * @default ["active", "trialing"]
   */
  allowedStatuses?: SubscriptionStatus[];
  /** Content to show while subscription status is loading */
  loading?: ReactNode;
}

export function PaywallGate({
  children,
  fallback,
  subscription: rawSubscription,
  allowedStatuses = DEFAULT_ALLOWED_STATUSES,
  loading = null,
}: PaywallGateProps): ReactElement | null {
  const { subscription, isLoading } = useSubscription(
    rawSubscription as Parameters<typeof useSubscription>[0]
  );

  if (isLoading) {
    return (loading ?? null) as ReactElement | null;
  }

  const hasAccess =
    subscription?.status != null &&
    allowedStatuses.includes(subscription.status);

  if (hasAccess) {
    return children as ReactElement;
  }

  return fallback as ReactElement;
}
