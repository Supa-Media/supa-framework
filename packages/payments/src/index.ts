/**
 * @supa-media/payments — Stripe payment integration for Supa apps.
 *
 * Provides hooks, components, and configuration for managing
 * subscriptions, products, and checkout with Stripe + Convex.
 *
 * @example
 * ```tsx
 * // Configure Stripe keys at app initialization
 * import { configureStripe } from "@supa-media/payments/config";
 *
 * configureStripe({
 *   development: { publishableKey: "pk_test_..." },
 *   staging: { publishableKey: "pk_test_..." },
 *   production: { publishableKey: "pk_live_..." },
 * });
 *
 * // Use subscription status in components
 * import { useSubscription } from "@supa-media/payments/hooks";
 * import { PaywallGate, SubscriptionStatusCard } from "@supa-media/payments/components";
 *
 * function App() {
 *   const data = useQuery(api.billing.getSubscriptionStatus, { communityId });
 *   const { isActive } = useSubscription(data);
 *
 *   return (
 *     <PaywallGate subscription={data} fallback={<UpgradeScreen />}>
 *       <PremiumFeature />
 *     </PaywallGate>
 *   );
 * }
 * ```
 */

// Config
export {
  configureStripe,
  getStripeConfig,
  getStripeConfigAuto,
  detectEnvironment,
} from "./config";

// Hooks
export { useSubscription } from "./hooks/useSubscription";
export { usePaymentSheet } from "./hooks/usePaymentSheet";
export { useProducts } from "./hooks/useProducts";

// Components
export { PaywallGate } from "./components/PaywallGate";
export { SubscriptionStatusCard } from "./components/SubscriptionStatusCard";

// Types
export type {
  Subscription,
  SubscriptionStatus,
  Product,
  Price,
  PriceInterval,
  CheckoutSession,
  StripeWebhookEventType,
  StripeConfig,
  StripeEnvironment,
  StripeConfigMap,
  UseSubscriptionResult,
  UsePaymentSheetResult,
  UseProductsResult,
  PaywallGateProps,
  SubscriptionStatusProps,
} from "./types";
