/**
 * Type definitions for @supa-media/payments
 *
 * Covers Stripe subscriptions, products, prices, checkout sessions,
 * and the hook return types used by consumer apps.
 */

// =============================================================================
// Subscription
// =============================================================================

/** Stripe subscription status values */
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "trialing"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

/** A user or entity's subscription record */
export interface Subscription {
  /** Stripe subscription ID (sub_...) */
  stripeSubscriptionId: string | null;
  /** Stripe customer ID (cus_...) */
  stripeCustomerId: string | null;
  /** Current subscription status */
  status: SubscriptionStatus | null;
  /** Monthly price in dollars (not cents) */
  priceMonthly: number | null;
  /** Billing contact email */
  billingEmail: string | null;
}

// =============================================================================
// Products & Prices
// =============================================================================

/** Billing interval for recurring prices */
export type PriceInterval = "month" | "year" | "week" | "day";

/** A Stripe product */
export interface Product {
  /** Stripe product ID (prod_...) */
  id: string;
  /** Display name */
  name: string;
  /** Optional description */
  description?: string;
  /** Whether the product is currently available */
  active: boolean;
  /** Arbitrary metadata */
  metadata: Record<string, string>;
}

/** A Stripe price attached to a product */
export interface Price {
  /** Stripe price ID (price_...) */
  id: string;
  /** Product this price belongs to */
  productId: string;
  /** Amount in cents */
  unitAmount: number;
  /** ISO currency code (e.g. "usd") */
  currency: string;
  /** Billing interval for recurring prices, null for one-time */
  interval: PriceInterval | null;
  /** Whether this price is active */
  active: boolean;
}

// =============================================================================
// Checkout
// =============================================================================

/** A Stripe Checkout session */
export interface CheckoutSession {
  /** Stripe session ID */
  id: string;
  /** URL to redirect the user to for payment */
  url: string;
  /** Mode: "subscription" or "payment" */
  mode: "subscription" | "payment";
  /** Status of the checkout session */
  status: "open" | "complete" | "expired";
}

// =============================================================================
// Webhook Events
// =============================================================================

/** Supported Stripe webhook event types */
export type StripeWebhookEventType =
  | "checkout.session.completed"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "invoice.payment_failed"
  | "invoice.paid";

// =============================================================================
// Config
// =============================================================================

/** Stripe configuration for a specific environment */
export interface StripeConfig {
  /** Stripe publishable key (pk_...) */
  publishableKey: string;
  /** Stripe secret key (sk_...) — only used server-side */
  secretKey?: string;
  /** Stripe webhook signing secret (whsec_...) — only used server-side */
  webhookSecret?: string;
  /** Stripe product ID to use for subscriptions */
  productId?: string;
  /** Stripe API version */
  apiVersion?: string;
}

/** Environment names for config lookup */
export type StripeEnvironment = "development" | "staging" | "production";

/** Full config map across environments */
export type StripeConfigMap = Record<StripeEnvironment, StripeConfig>;

// =============================================================================
// Hook Return Types
// =============================================================================

/** Return type for useSubscription() */
export interface UseSubscriptionResult {
  /** The current subscription data, or null if not subscribed */
  subscription: Subscription | null;
  /** Whether the subscription data is still loading */
  isLoading: boolean;
  /** Whether the user has an active subscription */
  isActive: boolean;
  /** Whether the subscription is past due */
  isPastDue: boolean;
  /** Whether the subscription is canceled */
  isCanceled: boolean;
  /** Whether the user is in a trial period */
  isTrialing: boolean;
}

/** Return type for usePaymentSheet() */
export interface UsePaymentSheetResult {
  /** Open the Stripe payment sheet */
  openPaymentSheet: () => Promise<{ error?: string }>;
  /** Whether the payment sheet is currently being presented */
  isPresenting: boolean;
  /** Whether the payment sheet is initialized and ready */
  isReady: boolean;
  /** Initialize the payment sheet with a client secret */
  initialize: (clientSecret: string) => Promise<void>;
}

/** Return type for useProducts() */
export interface UseProductsResult {
  /** Available products with their prices */
  products: Array<Product & { prices: Price[] }>;
  /** Whether products are still loading */
  isLoading: boolean;
}

// =============================================================================
// Component Props
// =============================================================================

/** Props for PaywallGate component */
export interface PaywallGateProps {
  /** Content to show when the user has an active subscription */
  children: unknown;
  /** Content to show when the user does not have an active subscription */
  fallback: unknown;
  /**
   * Subscription statuses that grant access. Defaults to ["active", "trialing"].
   * Customize to allow past_due users to keep access while resolving payment.
   */
  allowedStatuses?: SubscriptionStatus[];
  /** Content to show while subscription status is loading */
  loading?: unknown;
}

/** Props for SubscriptionStatus component */
export interface SubscriptionStatusProps {
  /** Override subscription data (otherwise uses useSubscription hook) */
  subscription?: Subscription | null;
  /** Whether to show the manage billing button */
  showManageButton?: boolean;
  /** Callback when the manage billing button is pressed */
  onManageBilling?: () => void;
  /** Whether to show the price information */
  showPrice?: boolean;
}
