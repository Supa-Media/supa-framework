/**
 * Payment Utilities
 *
 * Stripe integration helpers for Convex — webhook handling,
 * checkout session creation, and subscription management.
 *
 * Usage:
 * ```ts
 * import { handleStripeWebhook, getSubscriptionStatus } from "@supa-media/convex/payments";
 * ```
 */

// -- Types --

export interface CheckoutSessionParams {
  userId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface SubscriptionStatus {
  isActive: boolean;
  status: string | null;
  priceId: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

/** Minimal DB context for payment functions. */
interface PaymentCtx {
  db: {
    query: (table: string) => any;
    insert: (table: string, doc: any) => Promise<any>;
    patch: (id: any, fields: any) => Promise<void>;
  };
}

// -- Customer Management --

/**
 * Get or create a Stripe customer record for a Convex user.
 * Returns the stripeCustomerId.
 */
export async function getOrCreateCustomer(
  ctx: PaymentCtx,
  userId: string,
): Promise<{ stripeCustomerId: string; isNew: boolean }> {
  const existing = await ctx.db
    .query("customers")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();

  if (existing) {
    return { stripeCustomerId: existing.stripeCustomerId, isNew: false };
  }

  // Create Stripe customer via API
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  const user = await ctx.db.get(userId as any);
  const params = new URLSearchParams();
  if (user?.email) params.set("email", user.email);
  if (user?.name) params.set("name", user.name);
  if (user?.phone) params.set("phone", user.phone);
  params.set("metadata[convexUserId]", userId);

  const response = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Stripe customer creation failed: ${errorText}`);
  }

  const customer = await response.json();

  await ctx.db.insert("customers", {
    userId,
    stripeCustomerId: customer.id,
    createdAt: Date.now(),
  });

  return { stripeCustomerId: customer.id, isNew: true };
}

// -- Checkout --

/**
 * Create a Stripe Checkout Session.
 * Returns the checkout URL for redirecting the user.
 */
export async function createCheckoutSession(
  ctx: PaymentCtx,
  params: CheckoutSessionParams,
): Promise<{ url: string; sessionId: string }> {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  const { stripeCustomerId } = await getOrCreateCustomer(ctx, params.userId);

  const body = new URLSearchParams();
  body.set("customer", stripeCustomerId);
  body.set("mode", "subscription");
  body.set("line_items[0][price]", params.priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", params.successUrl);
  body.set("cancel_url", params.cancelUrl);

  if (params.metadata) {
    for (const [key, value] of Object.entries(params.metadata)) {
      body.set(`metadata[${key}]`, value);
    }
  }
  body.set("metadata[convexUserId]", params.userId);

  const response = await fetch(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Stripe checkout session creation failed: ${errorText}`);
  }

  const session = await response.json();
  return { url: session.url, sessionId: session.id };
}

// -- Subscription Status --

/**
 * Get the subscription status for a user.
 */
export async function getSubscriptionStatus(
  ctx: PaymentCtx,
  userId: string,
): Promise<SubscriptionStatus> {
  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();

  if (!subscription) {
    return {
      isActive: false,
      status: null,
      priceId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  const activeStatuses = ["active", "trialing"];

  return {
    isActive: activeStatuses.includes(subscription.status),
    status: subscription.status,
    priceId: subscription.priceId ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
  };
}

// -- Webhook Handling --

/**
 * Stripe webhook event types that this handler processes.
 */
type StripeWebhookEventType =
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "checkout.session.completed";

interface StripeWebhookEvent {
  type: string;
  data: {
    object: Record<string, any>;
  };
}

/**
 * Handle a Stripe webhook event.
 *
 * Designed to be called from a Convex HTTP endpoint. The caller is responsible
 * for verifying the webhook signature before calling this function.
 *
 * Processes:
 * - customer.subscription.created/updated/deleted — syncs subscription state
 * - checkout.session.completed — links customer to user if needed
 *
 * Usage:
 * ```ts
 * // convex/http.ts
 * import { handleStripeWebhook } from "@supa-media/convex/payments";
 *
 * const http = httpRouter();
 * http.route({
 *   path: "/stripe/webhook",
 *   method: "POST",
 *   handler: httpAction(async (ctx, request) => {
 *     const body = await request.text();
 *     // Verify signature here...
 *     const event = JSON.parse(body);
 *     await handleStripeWebhook(ctx, event);
 *     return new Response("ok", { status: 200 });
 *   }),
 * });
 * ```
 */
export async function handleStripeWebhook(
  ctx: PaymentCtx,
  event: StripeWebhookEvent,
): Promise<void> {
  const { type, data } = event;
  const obj = data.object;

  switch (type as StripeWebhookEventType) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const stripeSubscriptionId = obj.id;
      const stripeCustomerId = obj.customer;
      const status = obj.status;

      // Find the user by Stripe customer ID
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_stripeCustomerId", (q: any) =>
          q.eq("stripeCustomerId", stripeCustomerId),
        )
        .first();

      if (!customer) {
        console.warn(
          `Stripe webhook: no customer found for ${stripeCustomerId}`,
        );
        return;
      }

      // Check for existing subscription record
      const existingSub = await ctx.db
        .query("subscriptions")
        .withIndex("by_stripeSubscriptionId", (q: any) =>
          q.eq("stripeSubscriptionId", stripeSubscriptionId),
        )
        .first();

      const subData = {
        userId: customer.userId,
        stripeSubscriptionId,
        status,
        priceId: obj.items?.data?.[0]?.price?.id,
        productId: obj.items?.data?.[0]?.price?.product,
        currentPeriodStart: obj.current_period_start
          ? obj.current_period_start * 1000
          : undefined,
        currentPeriodEnd: obj.current_period_end
          ? obj.current_period_end * 1000
          : undefined,
        cancelAtPeriodEnd: obj.cancel_at_period_end ?? false,
        updatedAt: Date.now(),
      };

      if (existingSub) {
        await ctx.db.patch(existingSub._id, subData);
      } else {
        await ctx.db.insert("subscriptions", {
          ...subData,
          createdAt: Date.now(),
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const stripeSubscriptionId = obj.id;

      const existingSub = await ctx.db
        .query("subscriptions")
        .withIndex("by_stripeSubscriptionId", (q: any) =>
          q.eq("stripeSubscriptionId", stripeSubscriptionId),
        )
        .first();

      if (existingSub) {
        await ctx.db.patch(existingSub._id, {
          status: "canceled",
          updatedAt: Date.now(),
        });
      }
      break;
    }

    case "checkout.session.completed": {
      // Link customer to user if convexUserId is in metadata
      const convexUserId = obj.metadata?.convexUserId;
      const stripeCustomerId = obj.customer;

      if (convexUserId && stripeCustomerId) {
        const existing = await ctx.db
          .query("customers")
          .withIndex("by_stripeCustomerId", (q: any) =>
            q.eq("stripeCustomerId", stripeCustomerId),
          )
          .first();

        if (!existing) {
          await ctx.db.insert("customers", {
            userId: convexUserId,
            stripeCustomerId,
            createdAt: Date.now(),
          });
        }
      }
      break;
    }
  }
}

/**
 * Verify a Stripe webhook signature.
 * Uses the raw body and the Stripe-Signature header.
 *
 * Returns the parsed event if valid, throws if invalid.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signature: string,
  endpointSecret?: string,
): Promise<StripeWebhookEvent> {
  const secret = endpointSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }

  // Parse the signature header
  const elements = signature.split(",");
  const timestamp = elements
    .find((e) => e.startsWith("t="))
    ?.slice(2);
  const v1Signature = elements
    .find((e) => e.startsWith("v1="))
    ?.slice(3);

  if (!timestamp || !v1Signature) {
    throw new Error("Invalid Stripe signature format");
  }

  // Check timestamp tolerance (5 minutes)
  const tolerance = 5 * 60;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > tolerance) {
    throw new Error("Stripe webhook timestamp too old");
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedPayload),
  );
  const expectedSignature = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedSignature !== v1Signature) {
    throw new Error("Invalid Stripe webhook signature");
  }

  return JSON.parse(rawBody) as StripeWebhookEvent;
}
