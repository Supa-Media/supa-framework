/**
 * Webhook Signature Verification
 *
 * Dependency-free helpers for verifying signed (or shared-secret-gated)
 * inbound webhooks from inside a Convex `httpAction`. Built on the Web Crypto
 * API (`crypto.subtle`) so nothing here needs `node:crypto` or a provider SDK.
 *
 * - `verifyHmacSignature` / `computeHmac` / `timingSafeEqual` — the generic
 *   core for "HMAC over the raw body, compare against a header" schemes
 *   (GitHub's `X-Hub-Signature-256`, custom internal callback signing, ...).
 * - `verifyStripeSignature` — Stripe's `t=...,v1=...` scheme with timestamp
 *   tolerance and multi-signature (secret rotation) support.
 * - `verifyTwilioSignature` — Twilio's URL+sorted-params signing scheme.
 * - `verifySharedSecretHeader` — for providers with no signing scheme at all
 *   (e.g. Resend inbound email), gated by a constant shared-secret header
 *   instead of a cryptographic signature.
 *
 * Ported from production webhook handlers in Fount Studios
 * (`apps/convex/lib/webhooks/*`) and Togather (`apps/convex/http.ts`).
 *
 * NOTE: unlike most of this package's subpaths, this module is deliberately
 * NOT re-exported from the package root (`@supa-media/convex`). The
 * `./payments` subpath already exports its own `verifyStripeSignature` (a
 * simpler, single-signature variant scoped to `handleStripeWebhook`); adding
 * this module's `verifyStripeSignature` to the root barrel would collide with
 * it. Import from `@supa-media/convex/webhooks` explicitly.
 */
export {
  verifyHmacSignature,
  computeHmac,
  timingSafeEqual,
} from "./hmac";
export type { VerifyHmacSignatureOptions } from "./hmac";

export { verifyStripeSignature } from "./stripe";
export type { VerifyStripeSignatureOptions } from "./stripe";

export { verifyTwilioSignature } from "./twilio";
export type { VerifyTwilioSignatureArgs } from "./twilio";

export { verifySharedSecretHeader } from "./sharedSecret";
