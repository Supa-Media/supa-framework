/**
 * Twilio webhook signature verification.
 *
 * Twilio signs incoming webhook requests with HMAC-SHA1 using the account's
 * auth token. The signing input is built deterministically:
 *
 *   1. Start with the full request URL exactly as Twilio called it
 *      (scheme + host + path + query string).
 *   2. Sort the POST form parameter keys alphabetically.
 *   3. Append each key followed immediately by its value: `url + k1v1 + k2v2 + ...`.
 *   4. HMAC-SHA1 with the auth token as the key.
 *   5. Base64-encode the digest.
 *
 * Compare against the `X-Twilio-Signature` header using a timing-safe
 * equality check. Ported as-is from Fount Studios'
 * `apps/convex/lib/webhooks/twilio.ts` (issue #143) — the signing-input
 * construction is Twilio-specific and isn't expressible via the generic
 * `verifyHmacSignature` (which only covers "HMAC over the raw body" schemes).
 *
 * Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
import { timingSafeEqual, computeHmac } from "./hmac";

export interface VerifyTwilioSignatureArgs {
  /** The full URL Twilio POSTed to (must include scheme, host, and any query string). Must NOT be normalized — Twilio signs the exact bytes it sent. */
  url: string;
  /** The application/x-www-form-urlencoded body parsed into a flat `Record<string, string>`. */
  params: Record<string, string>;
  /** The `X-Twilio-Signature` header value sent by Twilio. Null/missing returns `false`. */
  signatureHeader: string | null | undefined;
  /** The Twilio account auth token used to sign the request. Must be the *auth token*, not an API key secret. */
  authToken: string;
}

/**
 * Verify a Twilio webhook signature.
 *
 * Usage:
 * ```ts
 * // convex/http.ts
 * import { verifyTwilioSignature } from "@supa-media/convex/webhooks";
 *
 * http.route({
 *   path: "/twilio/sms",
 *   method: "POST",
 *   handler: httpAction(async (ctx, request) => {
 *     const bodyText = await request.text();
 *     const params = Object.fromEntries(new URLSearchParams(bodyText));
 *     const ok = await verifyTwilioSignature({
 *       url: process.env.CONVEX_SITE_URL + "/twilio/sms",
 *       params,
 *       signatureHeader: request.headers.get("x-twilio-signature"),
 *       authToken: process.env.TWILIO_AUTH_TOKEN!,
 *     });
 *     if (!ok) return new Response("Invalid signature", { status: 401 });
 *     // ...
 *   }),
 * });
 * ```
 */
export async function verifyTwilioSignature(
  args: VerifyTwilioSignatureArgs,
): Promise<boolean> {
  if (!args.signatureHeader || !args.authToken) return false;

  const sortedKeys = Object.keys(args.params).sort();
  let signingInput = args.url;
  for (const key of sortedKeys) {
    // Key always exists (we just derived sortedKeys from this object's own
    // keys) — the `?? ""` only satisfies noUncheckedIndexedAccess.
    signingInput += key + (args.params[key] ?? "");
  }

  const expected = await computeHmac(args.authToken, signingInput, {
    hash: "SHA-1",
    encoding: "base64",
  });
  // Base64 digests are case-sensitive — compare exactly, no case-folding.
  return timingSafeEqual(args.signatureHeader, expected);
}
