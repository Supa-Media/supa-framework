# @supa-media/convex

**The backend half of a Supa app: phone/email OTP auth on top of
`@convex-dev/auth`, base schema tables (users, tenants, chat, notifications,
payments, rate limits), tenant-scoping discipline, webhook signature
verification, and a handful of small server utilities.** It is for Convex apps —
the code here runs inside your `convex/` functions directory and nowhere else.

Most of it is not new engineering. The webhook verifiers, the tenant scoping and
the OTP wiring are ports of code that was already running in Fount Studios and
Togather, generalized so a third app does not have to write them a third time.
The source carries the reasoning; this README points at it.

## Install

```
pnpm add @supa-media/convex
```

### Peer dependencies

Two, both required — there is no optional peer in this package:

| Peer | Range |
| --- | --- |
| `convex` | `>=1.31.0` |
| `@convex-dev/auth` | `>=0.0.90` |

Install it into the workspace package that holds your Convex functions, not the
mobile app.

## ⚠️ This package ships raw TypeScript, on purpose

`main` and `types` both point at `src/index.ts`. There is no `dist/`, no build
step, and no compiled artifact anywhere in the published tarball — only `src/`
and the licence. Convex's own bundler (esbuild) compiles your `convex/`
directory *and its dependencies*, so a build step here would be a second,
redundant compile of the same source.

What that means for you:

- **It works out of the box when imported from Convex functions.** That is the
  supported consumption model, and the only one.
- **Its relative imports are extension-less** (`from "./hmac"`). Convex's bundler
  and `moduleResolution: "bundler"` resolve those; plain Node's ESM loader does
  **not**. Importing this package from a bare Node script, a plain `tsc`
  `node16`/`nodenext` build, or any toolchain that expects compiled JS in
  `node_modules` will fail to resolve. The package's own test runner needs a
  25-line resolve hook (`test/ts-loader.mjs`) to get around exactly this.
- **Your typechecker must be willing to read `.ts` inside `node_modules`.** If
  you `skipLibCheck` or exclude `node_modules` from your program, you are fine;
  if you have a strict `allowJs: false` + declaration-only expectation, you are
  not.
- **Framework packages that ship raw TS do not depend on each other.** That is a
  deliberate rule, not an oversight: `@supa-media/dev-assistant` keeps a local
  copy of the HMAC helpers rather than importing this package, because pulling a
  whole PR-pipeline package in to reach fifteen lines of Web Crypto would be
  reuse in name only.

## Subpaths

| Subpath | Exports |
| --- | --- |
| `.` | Everything from `./auth`, `./schema`, `./lib`, `./notifications`, `./payments` — but **not** `./webhooks` |
| `@supa-media/convex/auth` | `createSupaAuth`, `MAGIC_LINK_PROVIDER_ID`, `requireAuth`, `requireAuthId`, `getOptionalAuth`, `getCurrentUserId` |
| `@supa-media/convex/schema` | `supaAuthTables`, `supaTenantTables`, `supaTenantScope`, `supaChatTables`, `supaNotificationTables`, `supaPaymentTables` |
| `@supa-media/convex/lib` | `checkRateLimit`, `supaRateLimitTable`, `isValidPhone`, `isValidEmail`, `normalizePhone`, `normalizeEmail`, `CronSchedules`, `Delay` |
| `@supa-media/convex/notifications` | `registerPushToken`, `cleanupExpiredTokens`, `enqueueNotification`, `sendPushNotification`, `sendNotificationToUser`, `processNotificationQueue` |
| `@supa-media/convex/payments` | `getOrCreateCustomer`, `createCheckoutSession`, `getSubscriptionStatus`, `handleStripeWebhook`, `verifyStripeSignature` |
| `@supa-media/convex/webhooks` | `verifyHmacSignature`, `computeHmac`, `timingSafeEqual`, `verifyStripeSignature`, `verifyTwilioSignature`, `verifySharedSecretHeader` |

> **⚠️ `./webhooks` is deliberately absent from the root barrel.** Both it and
> `./payments` export a `verifyStripeSignature`, and they are not the same
> function — see [Two `verifyStripeSignature`s](#two-verifystripesignatures).
> Import from `@supa-media/convex/webhooks` explicitly.

## Schema

Every table helper is a plain object of `defineTable()` results. Spread what you
want:

```ts
// convex/schema.ts
import { defineSchema } from "convex/server";
import {
  supaAuthTables,
  supaTenantTables,
  supaChatTables,
} from "@supa-media/convex/schema";

export default defineSchema({
  ...supaAuthTables,
  ...supaTenantTables({ tenantName: "organization" }),
  ...supaChatTables,
  // your tables…
});
```

| Helper | Tables | Notes |
| --- | --- | --- |
| `supaAuthTables` | `@convex-dev/auth`'s `authTables`, plus `users` | `users`: `name`, `email`, `phone`, `image`, `emailVerificationTime`, `phoneVerificationTime`, `isActive`, `createdAt` — all optional. Indexed `by_email`, `by_phone`. |
| `supaTenantTables(config)` | `{tenantName}s` + `user{TenantName}s` | Factory, see below |
| `supaChatTables` | `channels`, `channelMembers`, `messages` | |
| `supaNotificationTables` | `pushTokens`, `notificationQueue` | Table names and indexes are hardcoded into `./notifications` |
| `supaPaymentTables` | `customers`, `subscriptions` | Table names and indexes are hardcoded into `./payments` |
| `supaRateLimitTable` (from `./lib`) | `rateLimits` | |

`createSupaAuth`'s user-creation callback writes `email`, `phone`, `name`,
`image`, the two verification timestamps, `isActive` and `createdAt` — so if you
define your own `users` table instead of using `supaAuthTables`, it must accept
those fields.

### `supaTenantTables`

```ts
function supaTenantTables(config: {
  tenantName: string;                                   // "organization", "workspace", "community"…
  tenantFields?: Record<string, Validator<any, any, any>>;
}): Record<string, TableDefinition>
```

Produces `{tenantName}s` (`name`, `slug`, `image`, `isActive`, `createdAt`, plus
your `tenantFields`; indexed `by_slug`, `by_name`) and the junction
`user{TenantName}s` (`userId`, `{tenantName}Id`, `role`, `isActive`, `joinedAt`;
indexed `by_userId`, `by_{tenantName}Id`, `by_userId_{tenantName}Id`).

> **⚠️ The junction's tenant FK is `v.string()`, not `v.id()`.** `v.id()` needs a
> literal table name, which a factory parameterized on `tenantName` does not
> have. You get no referential typing on that column — validate it yourself where
> it matters.

### `supaTenantScope`

The query-time complement. Generalized from Fount Studios' `lib/org.ts`
(`rowInOrg` / `activeOrgMemberIds` / `requireOrg`), parameterized by
`tenantName` so it derives exactly the identifiers `supaTenantTables` created.

```ts
const scope: SupaTenantScope = supaTenantScope({ tenantName: "organization" });

scope.tenantIdField;        // "organizationId"
scope.activeTenantField;    // "activeOrganizationId"
scope.junctionTableName;    // "userOrganizations"

scope.rowInTenant(row, tenantId: string | null): boolean
scope.getCurrentTenantId(ctx, userId): Promise<string | null>
scope.isMemberOfTenant(ctx, userId, tenantId): Promise<boolean>
scope.requireTenantId(ctx, userId): Promise<string>        // throws NO_ACTIVE_TENANT / FORBIDDEN
scope.activeTenantMemberIds(ctx, tenantId): Promise<Set<string>>
```

The pattern in one line: resolve the active tenant **once** at the top of a
handler, then filter collected rows with the cheap in-memory `rowInTenant`.

```ts
// convex/functions/bookings.ts
import { requireAuthId } from "@supa-media/convex/auth";
import { orgScope } from "../lib/tenant";

export const list = query({
  handler: async (ctx) => {
    const userId = await requireAuthId(ctx);
    const orgId = await orgScope.getCurrentTenantId(ctx, userId);
    return (await ctx.db.query("bookings").collect())
      .filter((row) => orgScope.rowInTenant(row, orgId));
  },
});
```

Three things to know before you rely on it:

> **⚠️ `rowInTenant(row, null)` returns `true` for every row.** A null tenant id
> degrades to *unfiltered reads*. That is intentional — it is a migration safety
> net so an app keeps working before the backfill stamps rows — but it means a
> user whose active tenant cannot be resolved sees everything. `getCurrentTenantId`
> returns `null` whenever the user has 0 or 2+ active memberships and no explicit
> `activeTenantField`. On any surface where that would be a leak, use
> `requireTenantId`, which throws instead.

- **`activeTenantField` is yours to add.** `supaAuthTables` does not define
  `active{TenantName}Id` on `users`. Add it to your own users table.
- **No super-admin bypass, and no auth coupling.** Fount's original let a global
  Super Admin skip the membership check; that assumes a roles system this package
  does not ship. Auth is decoupled too — you resolve `userId` yourself (via
  `requireAuthId`) and pass it in. Wrap `requireTenantId` if you need a bypass.

## Auth

### `createSupaAuth`

```ts
function createSupaAuth(config?: {
  appName?: string;
  methods?: Array<"email" | "phone">;      // default ["email", "phone"]
  magicLink?: SupaAuthMagicLinkConfig;     // off unless present
  resend?: { fromAddress: string; emailSubject?: (code) => string;
             renderHtml?: (p: { code, email }) => string };
  twilio?: { tokenBridgePath?: string };   // default "/api/internal/phone-token"
  productionIdentifier?: string;
}): ReturnType<typeof convexAuth>
```

Returns exactly what `convexAuth()` returns. The scaffold's `convex/auth.ts` is
the whole integration:

```ts
import { createSupaAuth } from "@supa-media/convex/auth";

export const { auth, signIn, signOut, store, isAuthenticated } = createSupaAuth({
  appName: "MyApp",
  methods: ["email", "phone"],
  resend: {
    fromAddress: "auth@myapp.com",
    emailSubject: (code) => `${code} is your MyApp code`,
  },
});
```

**Email OTP** posts to the Resend REST API directly with `fetch` — no `resend`
SDK dependency. With no `RESEND_API_KEY`, it logs the code to the Convex console
instead of failing, which is what makes local dev work.

**`createOrUpdateUser`** links a new auth account to an existing user by phone or
email before creating one, and refreshes the matching verification timestamp.
Note that both lookups use `ctx.db.query("users").filter(...)`, a full table
scan, even though `supaAuthTables` indexes `by_email` and `by_phone` — fine at
small scale, worth knowing at large.

**Dev bypass.** With `DEV_OTP_BYPASS=true`, the generator returns `000000`
instead of a random code. Pass `productionIdentifier` (a substring of your
production deployment name, e.g. `"giddy-donkey-905"`) and the bypass is refused
— with a console error — whenever `CONVEX_SITE_URL` contains it. Set that; it is
the only thing standing between a stray env var and a universally-known
production login code.

> **⚠️ Phone OTP needs a bridge endpoint that this package does not ship.**
> The phone provider POSTs `{ phone, token, expiresAt }` to
> `${CONVEX_SITE_URL}${tokenBridgePath}` with `Authorization: Bearer
> $PHONE_TOKEN_BRIDGE_SECRET`, and *separately* asks Twilio Verify to SMS its own
> code. Two codes are therefore in play: the `@convex-dev/auth` token you stashed,
> and Twilio's. **You must implement the bridge `httpAction` and the
> reconciliation** — check the user's Twilio code, look up the stashed token, call
> `signIn` with it. Neither piece is in this package. If `CONVEX_SITE_URL` or
> `PHONE_TOKEN_BRIDGE_SECRET` is unset, the provider logs the raw token to the
> console and returns, so local dev degrades rather than breaks.

### Magic link (opt-in)

Set `magicLink: {}` and a **second** email provider is registered under
`MAGIC_LINK_PROVIDER_ID` (`"magic-link"`), gated on the `email` method.

```ts
import { MAGIC_LINK_PROVIDER_ID } from "@supa-media/convex/auth";

// Mint the code yourself, put it in a URL, and mail it:
await ctx.runMutation(internal.auth.store, {
  args: {
    type: "createVerificationCode",
    provider: MAGIC_LINK_PROVIDER_ID,
    email,
    code,                    // 32+ random bytes — see the warning below
    expirationTime,
    allowExtraProviders: false,
  },
});
```

Redemption needs nothing from you: `@convex-dev/auth`'s React provider reads the
`code` query param on mount, signs in, and strips it from the URL.

Why a separate provider rather than a flag on the OTP one — this is the part
worth reading before anyone "simplifies" it:

- `Email()` from `@convex-dev/auth` hardcodes an `authorize` that refuses any
  verification without a matching `params.email`. Correct for a typed code,
  wrong for a link whose URL is meant to carry everything. Its docstring says to
  pass `authorize: undefined`; **in 0.0.90 that does nothing**, because the
  factory builds its result field by field and never spreads `config`. The only
  way to clear it is to spread the built provider and override afterwards.
- Clearing it on the *OTP* provider instead is one line shorter and looks
  identical. It is not. `verifyCodeAndSignIn` derives its **rate-limit key from
  `params.email`** — a verification carrying no email is not rate limited at all,
  and the OTP secret is six digits. That turns a one-in-a-million guess against
  one account into an unthrottled guess against every code in flight.
- `id` is overridden for the same reason `authorize` is: `Email()` hardcodes it
  too, so without the override both providers would be called `"email"` and
  `getProviderOrThrow` could not tell them apart — the separation would silently
  be no separation.

The two cannot be confused at redemption: the library resolves which `authorize`
to run from the provider recorded **on the verification row**, not from what the
caller claims.

> **⚠️ Magic-link token entropy is the caller's responsibility.** This provider
> has no email check and no rate limit; the token *is* the secret. Mint 32 random
> bytes or more. Nothing here can check that, because your app mints the code.

`api.auth.signIn` is public, so anyone can request a link for an address they do
not own. That is a nuisance, not a hole: the library's own generator produces
~190 bits, and the mail goes to the named address, not the requester. What an
attacker gets is the ability to invalidate somebody's pending code — which
`signIn("email", { email })` could always do too.

### Auth helpers

```ts
requireAuth(ctx): Promise<Record<string, any>>        // throws NOT_AUTHENTICATED / USER_NOT_FOUND
requireAuthId(ctx): Promise<string>                   // throws NOT_AUTHENTICATED
getOptionalAuth(ctx): Promise<Record<string, any> | null>
getCurrentUserId(ctx): Promise<string | null>
```

All four wrap `getAuthUserId` and take a duck-typed `{ db, auth }` context, so
they work in queries, mutations and actions without importing your generated
types. The two `require*` helpers throw **`ConvexError`** with a `{ code,
message }` payload — not a plain `Error` — which is what lets a client
distinguish "log in again" from "something broke".

Note the returns are `Record<string, any>` / `string`, not `Doc<"users">` /
`Id<"users">`: genericity costs you the generated types here. Cast at the call
site if you want them back.

## Webhooks

Dependency-free verification for inbound webhooks, built on Web Crypto
(`crypto.subtle`) because the Convex runtime is a V8 isolate with no
`node:crypto`. Ported from production handlers in Fount Studios and Togather.

```ts
timingSafeEqual(a: string, b: string): boolean
computeHmac(secret, message, opts?: { hash?: "SHA-256" | "SHA-1"; encoding?: "hex" | "base64" }): Promise<string>
verifyHmacSignature(payload, providedSignature, secret, opts?: { hash?, encoding?, prefix? }): Promise<boolean>
verifyStripeSignature(payload, signatureHeader, secret, opts?: { toleranceSeconds?: number }): Promise<boolean>
verifyTwilioSignature(args: { url, params, signatureHeader, authToken }): Promise<boolean>
verifySharedSecretHeader(headers, headerName, expectedSecret): boolean
```

Every verifier **returns `false` rather than throwing** on a malformed header,
an expired timestamp, or a mismatch. Hex comparisons are case-folded (providers
disagree on casing); base64 comparisons are not.

```ts
// convex/http.ts — Stripe
import { verifyStripeSignature } from "@supa-media/convex/webhooks";

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const ok = await verifyStripeSignature(
      body,
      request.headers.get("stripe-signature"),
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
    if (!ok) return new Response("Invalid signature", { status: 400 });
    // …
  }),
});
```

```ts
// GitHub's X-Hub-Signature-256 — the generic core, with a required prefix
const ok = await verifyHmacSignature(rawBody, request.headers.get("x-hub-signature-256"), secret, {
  prefix: "sha256=",
});
```

`verifyTwilioSignature` implements Twilio's own scheme — HMAC-SHA1, base64, over
`url + k1v1 + k2v2 + …` with keys sorted alphabetically:

```ts
const params = Object.fromEntries(new URLSearchParams(await request.text()));
const ok = await verifyTwilioSignature({
  url: process.env.CONVEX_SITE_URL + "/twilio/sms",   // exactly as Twilio called it
  params,
  signatureHeader: request.headers.get("x-twilio-signature"),
  authToken: process.env.TWILIO_AUTH_TOKEN!,          // the auth token, not an API key secret
});
```

> **⚠️ The Twilio URL must not be normalized.** Twilio signs the exact bytes it
> sent, query string included. Strip a trailing slash or reorder the query and
> verification fails.

`verifySharedSecretHeader` exists for providers with **no signing scheme at
all** — Resend's inbound email being the real case it was extracted from. Do not
reach for `verifyHmacSignature` when there is nothing to verify against; a
constant shared secret, compared in constant time, is the honest answer.

### Two `verifyStripeSignature`s

| | `./webhooks` | `./payments` |
| --- | --- | --- |
| Returns | `boolean`, never throws | the parsed event, **throws** on failure |
| Multiple `v1=` (secret rotation) | accepts any match | first `v1=` only |
| Tolerance | configurable, default 300s | fixed 300s |
| Timing-safe compare | yes | yes (since 1.1.0 — it was a plain `!==` before) |

**Prefer the `./webhooks` one.** The `./payments` variant exists as a
convenience scoped to `handleStripeWebhook` and is the narrower of the two.

## Notifications

Plain async functions over the Expo Push API — **not** Convex functions. You
wrap them in your own mutations/actions. They take a duck-typed `{ db }` context
and assume the exact table names and indexes from `supaNotificationTables`.

```ts
registerPushToken(ctx, userId, token, platform: "ios" | "android" | "web"): Promise<void>
cleanupExpiredTokens(ctx, invalidTokens: string[]): Promise<number>
enqueueNotification(ctx, payload: NotificationPayload): Promise<string>
sendPushNotification(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>   // no ctx — network only
sendNotificationToUser(ctx, payload): Promise<{ sent: number; tokens: string[] }>
processNotificationQueue(ctx, batchSize = 100): Promise<{ processed: number; failed: number }>
```

`registerPushToken` upserts, reassigning the token's `userId` if the same device
is now a different user. `processNotificationQueue` is built for a cron: it takes
`batchSize` pending rows and marks each `sent` or `failed` (with the error text
on the row).

> **⚠️ `sendPushNotification` calls `fetch`, so anything transitively reaching it
> — `sendNotificationToUser`, `processNotificationQueue` — must run in a Convex
> **action**, not a mutation. But those two also touch `ctx.db`, which an action
> does not have.** Split the work: read tokens / patch rows in mutations, do the
> HTTP call in an action, and drive it with `ctx.scheduler` or `ctx.runMutation`.

## Payments

Stripe helpers that call the REST API with `fetch` and `URLSearchParams` — no
`stripe` SDK dependency. Same duck-typed `{ db }` context, same hardcoded
dependency on `supaPaymentTables`' `customers` / `subscriptions` tables.

```ts
getOrCreateCustomer(ctx, userId): Promise<{ stripeCustomerId: string; isNew: boolean }>
createCheckoutSession(ctx, params: CheckoutSessionParams): Promise<{ url: string; sessionId: string }>
getSubscriptionStatus(ctx, userId): Promise<SubscriptionStatus>
handleStripeWebhook(ctx, event): Promise<void>
```

`createCheckoutSession` always creates a `mode=subscription` session with a
single line item and stamps `metadata[convexUserId]`. `handleStripeWebhook`
handles four event types — `customer.subscription.created` / `.updated` /
`.deleted` and `checkout.session.completed` — upserting the `subscriptions` row
and converting Stripe's second-precision periods to milliseconds. It **does not
verify the signature**; verify before you call it. Anything else is ignored
silently. `getSubscriptionStatus` counts `active` and `trialing` as
`isActive: true`.

Both write paths read `STRIPE_SECRET_KEY` from `process.env` and throw a clear
error if it is unset.

## Lib

```ts
checkRateLimit(ctx, key: string, maxAttempts: number, windowMs: number): Promise<void>
```

A DB-backed sliding-window counter over the `rateLimits` table
(`supaRateLimitTable`), meant for brute-force prevention on OTP endpoints. The
window auto-resets when it expires. Note it throws a **plain `Error`** with the
generic message "Too many attempts. Please try again later." — not a
`ConvexError` like the auth helpers, so a client cannot branch on a code.

```ts
isValidPhone(phone): boolean          // strict E.164: /^\+[1-9]\d{6,14}$/
isValidEmail(email): boolean          // basic shape check, not exhaustive
normalizePhone(phone): string         // strips spaces/dashes/parens/dots; THROWS if not E.164
normalizeEmail(email): string         // trim + lowercase; THROWS if invalid
```

`normalizePhone` does **not** add a country code — the input must already carry
one.

```ts
CronSchedules.everyMinute | every5Minutes | every15Minutes | every30Minutes
             | everyHour | daily | weekly | monthly
CronSchedules.dailyAt(hour: number)   // 0-23, UTC
Delay.seconds(n) | minutes(n) | hours(n) | days(n)   // → ms, for ctx.scheduler.runAfter
```

## Environment variables

| Var | Used by |
| --- | --- |
| `RESEND_API_KEY` | Email OTP send (absent → code logged to console) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Phone OTP send; the auth token also signs Twilio webhooks |
| `CONVEX_SITE_URL` | Phone token bridge target; production check for the dev bypass |
| `PHONE_TOKEN_BRIDGE_SECRET` | Bearer credential for your bridge endpoint |
| `DEV_OTP_BYPASS` | `"true"` forces the `000000` code — guard it with `productionIdentifier` |
| `STRIPE_SECRET_KEY` | `getOrCreateCustomer`, `createCheckoutSession` |
| `STRIPE_WEBHOOK_SECRET` | `./payments`' `verifyStripeSignature` fallback |

## Maturity and test coverage

56 tests across four files, run with `pnpm test` (`node --test` plus the
`test/ts-loader.mjs` resolve hook — no external test framework). Coverage is
deep in two places and absent in several:

| Area | Tests | |
| --- | --- | --- |
| `./webhooks` | 30 | Vector tests. Expected digests are computed independently with Node's `node:crypto`, not by calling `computeHmac`, so a bug in the implementation cannot also corrupt the expectation. Includes a real Fount Studios production fixture for Twilio. |
| `supaTenantScope` | 16 | Against an in-memory fake of the `db` interface — every branch of `getCurrentTenantId`, both `requireTenantId` throws, the null-tenant degradation |
| Magic link | 8 | Pins the upstream `Email()` factory's behaviour (that it ignores `id` and `authorize`) and that the OTP provider keeps its email check |
| `./payments` `verifyStripeSignature` | 2 | Accept valid, reject invalid |

**Untested here:** `./notifications` entirely, `checkRateLimit`, the validation
and scheduling helpers, every schema table definition, `createSupaAuth`'s
`createOrUpdateUser` linking logic, and the email/phone OTP send paths. Those are
exercised in the consuming apps, not in this package.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework

MIT licensed.
