# @supa-media/payments

**Client-side Stripe wiring for Expo/React Native apps on Convex** — environment-separated
publishable keys, a payment-sheet wrapper, and two subscription UI primitives. It is the
*view half* of a Stripe integration: the server half (customer records, checkout sessions,
webhook verification) lives in [`@supa-media/convex/payments`](https://github.com/Supa-Media/supa-framework/blob/main/packages/convex/src/payments/index.ts),
and you must wire it up yourself. `pnpm add` is not the whole job.

## Install

```bash
pnpm add @supa-media/payments
```

**Peer dependencies you install yourself:**

| Peer | Required? | Why |
| --- | --- | --- |
| `react >=19.0.0` | required | hooks |
| `react-native >=0.81.0` | required | `SubscriptionStatusCard` renders RN primitives |
| `convex >=1.31.0` | required by the manifest | *nothing in `src/` imports it* — the hooks take a raw `useQuery` result as a plain argument. Declared because the intended backend is Convex |
| `@stripe/stripe-react-native >=0.35.0` | **optional** | only for `usePaymentSheet`. The package never imports it; you pass `useStripe()`'s return value in as an argument |

## API

Everything below is reachable through the `exports` map; nothing else is public.

### `@supa-media/payments/config`

```ts
configureStripe(config: StripeConfigMap): void
getStripeConfig(environment: StripeEnvironment): StripeConfig   // throws if unconfigured
detectEnvironment(): StripeEnvironment                          // "development" | "staging" | "production"
getStripeConfigAuto(): StripeConfig                             // getStripeConfig(detectEnvironment())
```

`configureStripe` writes to a module-level holder — call it once, at app init, before any
payment screen mounts.

```ts
import { configureStripe, getStripeConfig } from "@supa-media/payments/config";

configureStripe({
  development: { publishableKey: "pk_test_..." },
  staging:     { publishableKey: "pk_test_..." },
  production:  { publishableKey: "pk_live_..." },
});
```

> **⚠️ The package does not initialize Stripe for you.** `getStripeConfig` returns a plain
> object; nothing consumes it. You still have to hand `publishableKey` to
> `<StripeProvider publishableKey={...}>` yourself. Reading the config and forgetting that
> step yields an app that compiles, runs, and never talks to Stripe.

> **⚠️ `StripeConfig` carries `secretKey` and `webhookSecret` fields. Never populate them in
> the map you pass to `configureStripe`.** That map is bundled into the mobile binary and is
> readable by anyone with the `.ipa`/`.apk`. Those two fields exist because the same type
> describes your *server* config; on the client, set `publishableKey` only.

> **⚠️ `detectEnvironment()` is unreliable inside an Expo bundle.** It reads `STRIPE_ENV`,
> then `APP_ENV`, then `NODE_ENV` off `process.env`. Metro only inlines `NODE_ENV` and
> `EXPO_PUBLIC_*` names, so the first two are almost always `undefined` on a device and the
> function falls through to `"development"` — meaning `getStripeConfigAuto()` silently hands
> a production build your **test** key. Prefer `getStripeConfig(myEnv)` with an environment
> you resolve yourself.

### `@supa-media/payments/hooks`

| Hook | Signature | Notes |
| --- | --- | --- |
| `useSubscription` | `(queryResult) => UseSubscriptionResult` | Normalizes a raw backend row. `undefined` ⇒ `isLoading: true`; `null` ⇒ no subscription |
| `useProducts` | `(queryResult) => UseProductsResult` | Normalizes products + nested prices |
| `usePaymentSheet` | `(stripe) => UsePaymentSheetResult` | `stripe` is the object returned by `useStripe()` |

`useSubscription` accepts two field-naming conventions so it fits either backend shape:
`subscriptionStatus`/`status` and `subscriptionPriceMonthly`/`priceMonthly`, plus
`stripeSubscriptionId`, `stripeCustomerId`, `billingEmail`. It returns the normalized
`subscription` object alongside `isActive` / `isPastDue` / `isCanceled` / `isTrialing`.

```tsx
function BillingScreen({ communityId }: { communityId: Id<"communities"> }) {
  // "skip" until the args are ready — the standard Convex idiom.
  const data = useQuery(
    api.functions.ee.billing.getSubscriptionStatus,
    token && communityId ? { token, communityId } : "skip",
  );
  const { isActive, isPastDue, subscription } = useSubscription(data);

  if (isActive) return <ActiveView subscription={subscription} />;
  if (isPastDue) return <PastDueWarning />;
  return <SubscribePrompt />;
}
```

That query is Togather's, and its return —
`{ subscriptionStatus, subscriptionPriceMonthly, stripeCustomerId, billingEmail }` — is the
shape `useSubscription` normalizes without any mapping.

`useProducts` tolerates `id`/`_id`, `unitAmount`/`unit_amount`/`amount`, and
`interval`/`recurring.interval`; an unrecognized interval normalizes to `null` rather than
throwing.

`usePaymentSheet` deliberately takes the Stripe SDK as an argument instead of importing it,
so the package stays installable without the native module:

```tsx
import { useStripe } from "@stripe/stripe-react-native";
import { usePaymentSheet } from "@supa-media/payments/hooks";

const stripe = useStripe();
const { initialize, openPaymentSheet, isReady, isPresenting } = usePaymentSheet(stripe);

useEffect(() => { initialize(clientSecret); }, [clientSecret]);

const pay = async () => {
  const { error } = await openPaymentSheet();
  if (!error) onPaid();
};
```

> **⚠️ `initialize()` never rejects and never reports failure to the caller.** A missing
> `stripe` argument logs a warning; a Stripe error is logged and swallowed. Both leave
> `isReady` at `false` forever, so the only symptom is a pay button that stays disabled.
> Watch the console, or gate your UI on `isReady` explicitly.

> **⚠️ `merchantDisplayName` is hardcoded to `"Payment"`.** It is not a prop. If you need
> your own merchant name in the sheet, call `initPaymentSheet` directly.

### `@supa-media/payments/components`

```tsx
<PaywallGate
  subscription={rawQueryResult}      // required; passed straight to useSubscription
  fallback={<UpgradeScreen />}
  loading={<Spinner />}              // optional, defaults to null
  allowedStatuses={["active", "trialing"]}  // default
>
  <PremiumFeature />
</PaywallGate>
```

```tsx
<SubscriptionStatusCard
  subscription={rawQueryResult}
  showPrice                          // default true
  showManageButton                   // default true — also needs onManageBilling to render
  onManageBilling={() => openBillingPortal()}
  manageBillingLoading={isOpening}
  pastDueMessage="…"                 // optional copy overrides
  canceledMessage="…"
/>
```

`SubscriptionStatusCard` renders a status badge (active, trialing, past_due, canceled,
unpaid, incomplete, paused — unknown statuses fall back to a grey badge showing the raw
string), a monthly price row, the manage button, and a warning box for `past_due` /
`canceled`. Its colors are fixed constants, not themeable props.

> **⚠️ `PaywallGate`'s default `allowedStatuses` includes `trialing`, but
> `useSubscription().isActive` is `status === "active"` only.** Trialing users pass the gate
> and fail an `isActive` check. Pick one of the two and use it consistently.

> **⚠️ The `PaywallGateProps` and `SubscriptionStatusProps` types exported from
> `./types` do not match the components.** Both components declare their props inline, and
> the exported types have drifted: `PaywallGateProps` has no `subscription` field and types
> children as `unknown`; `SubscriptionStatusProps` is missing `manageBillingLoading`,
> `pastDueMessage`, and `canceledMessage`. Type your wrappers with
> `React.ComponentProps<typeof PaywallGate>` instead.

### `@supa-media/payments/types`

`Subscription`, `SubscriptionStatus`, `Product`, `Price`, `PriceInterval`,
`CheckoutSession`, `StripeWebhookEventType`, `StripeConfig`, `StripeEnvironment`,
`StripeConfigMap`, `UseSubscriptionResult`, `UsePaymentSheetResult`, `UseProductsResult`,
`PaywallGateProps`, `SubscriptionStatusProps`. All are type-only; the root entry re-exports
every one of them.

## What you must build on the backend

This package reads data and presents a sheet. Everything that touches Stripe with a secret
key is yours to mount, from [`@supa-media/convex`](https://github.com/Supa-Media/supa-framework/tree/main/packages/convex):

**1. Tables** — `supaPaymentTables` gives you `customers` (`userId` → `stripeCustomerId`)
and `subscriptions` (status, `priceId`, period bounds, `cancelAtPeriodEnd`):

```ts
import { defineSchema } from "convex/server";
import { supaAuthTables, supaPaymentTables } from "@supa-media/convex/schema";

export default defineSchema({ ...supaAuthTables, ...supaPaymentTables });
```

**2. Server helpers** — wrap these plain async functions from
`@supa-media/convex/payments` in your own Convex functions:

| Helper | Use |
| --- | --- |
| `getOrCreateCustomer(ctx, userId)` | idempotent Stripe customer creation |
| `createCheckoutSession(ctx, params)` | returns `{ url, sessionId }` to open |
| `getSubscriptionStatus(ctx, userId)` | the query behind `useSubscription` |
| `verifyStripeSignature(rawBody, sig, secret?)` | constant-time HMAC check; enforces a 5-minute timestamp tolerance |
| `handleStripeWebhook(ctx, event)` | syncs `customer.subscription.created/updated/deleted` and `checkout.session.completed` |

**3. A webhook route** in `convex/http.ts` that calls `verifyStripeSignature` **before**
`handleStripeWebhook` — the handler does not verify anything itself.

**4. Convex env vars** — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, per deployment.
Staging and production are separate deployments, which is where the staging/production key
separation actually happens; the client-side `StripeConfigMap` only picks which
*publishable* key the app ships with.

> **⚠️ `getSubscriptionStatus` from `@supa-media/convex/payments` returns
> `{ isActive, status, priceId, currentPeriodEnd, cancelAtPeriodEnd }` — no `priceMonthly`,
> no `billingEmail`, no `stripeCustomerId`.** Feed that return value straight into
> `useSubscription` and the status logic works, but `SubscriptionStatusCard` renders
> `--/month`. Add the fields your UI needs to your own query.

## Test coverage

One test: `__tests__/esm-resolution.test.js`, which walks the built `dist/` output and
asserts every relative ESM specifier resolves under Node's strict rules (the 1.0.1 CHANGELOG
explains why that bug class is invisible to `tsc`). There are **no behavioural tests** — no
coverage of `useSubscription` normalization, the config holder, `PaywallGate` gating, or the
payment sheet. Treat the gotchas above as the specification and verify payment flows on a
real device against Stripe test mode.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework. MIT.
