/**
 * Stripe webhook signature verification.
 *
 * Stripe signs webhooks with `Stripe-Signature: t=<timestamp>,v1=<hex hmac>[,v1=<hex hmac>...]`.
 * The signed payload is `${timestamp}.${rawBody}`, HMAC-SHA256'd with the
 * endpoint's webhook signing secret. Stripe can send multiple `v1=` values
 * during a secret rotation window — any one matching is sufficient.
 *
 * This is a hand-rolled Web Crypto implementation (mirrors Togather's
 * `apps/convex/http.ts`) rather than the `stripe` npm SDK's
 * `stripe.webhooks.constructEventAsync`. The SDK works too, but pulling it
 * into a framework package for signature verification alone would be a heavy
 * runtime dependency for one function — the signing scheme itself is public
 * and documented, so we verify it directly with `crypto.subtle`.
 *
 * https://docs.stripe.com/webhooks#verify-official-libraries
 */
import { timingSafeEqual, computeHmac } from "./hmac";

export interface VerifyStripeSignatureOptions {
  /** Max allowed clock skew between the signed timestamp and now, in seconds. Defaults to 300 (5 minutes), matching Stripe's own tolerance. */
  toleranceSeconds?: number;
}

/**
 * Verify a Stripe `Stripe-Signature` header against the raw request body.
 * Returns `false` (never throws) on any malformed header, expired timestamp,
 * or signature mismatch.
 *
 * Usage:
 * ```ts
 * // convex/http.ts
 * import { verifyStripeSignature } from "@supa-media/convex/webhooks";
 *
 * http.route({
 *   path: "/stripe/webhook",
 *   method: "POST",
 *   handler: httpAction(async (ctx, request) => {
 *     const body = await request.text();
 *     const signature = request.headers.get("stripe-signature");
 *     const ok = await verifyStripeSignature(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
 *     if (!ok) return new Response("Invalid signature", { status: 400 });
 *     const event = JSON.parse(body);
 *     // ...
 *   }),
 * });
 * ```
 */
export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: VerifyStripeSignatureOptions = {},
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const { toleranceSeconds = 300 } = options;

  try {
    // Parse signature header into timestamp and all v1 signatures. Stripe
    // may send multiple v1 signatures during secret rotation, so we collect
    // them all and match against any one.
    let timestamp = "";
    const v1Signatures: string[] = [];

    for (const part of signatureHeader.split(",")) {
      const [key, value] = part.split("=");
      if (key === undefined || value === undefined) continue;
      const trimmedKey = key.trim();
      if (trimmedKey === "t") {
        timestamp = value;
      } else if (trimmedKey === "v1") {
        v1Signatures.push(value);
      }
    }

    if (!timestamp || v1Signatures.length === 0) return false;

    // Check timestamp is within tolerance to prevent replay attacks.
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp, 10)) > toleranceSeconds) {
      return false;
    }

    const signedPayload = `${timestamp}.${payload}`;
    const computedSig = await computeHmac(secret, signedPayload, {
      hash: "SHA-256",
      encoding: "hex",
    });

    // Accept if any v1 signature matches (constant-time comparison).
    return v1Signatures.some((sig) =>
      timingSafeEqual(sig.toLowerCase(), computedSig.toLowerCase()),
    );
  } catch {
    return false;
  }
}
