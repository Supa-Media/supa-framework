/**
 * Generic HMAC Signature Verification
 *
 * A small, dependency-free core for verifying HMAC-signed webhook requests
 * (Stripe, GitHub, custom internal callbacks, ...) from inside a Convex
 * `httpAction`. Convex's default runtime doesn't have `node:crypto`, so this
 * uses the standard Web Crypto API (`crypto.subtle`) — the same approach
 * production code in both Fount Studios and Togather already relies on for
 * hand-rolled webhook verification (as opposed to pulling in a provider SDK).
 *
 * Provider-specific verifiers (`verifyStripeSignature`, `verifyTwilioSignature`,
 * ...) are built on top of this — see the sibling files in this directory.
 */

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares every character regardless of where a mismatch occurs, so an
 * attacker can't use response-time differences to guess the signature
 * byte-by-byte.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.byteLength; i++) {
    binary += String.fromCharCode(view[i] as number);
  }
  // btoa is a Web standard available in the Convex runtime.
  return btoa(binary);
}

/** Compute an HMAC digest and encode it as hex or base64. */
export async function computeHmac(
  secret: string,
  message: string,
  options: { hash?: "SHA-256" | "SHA-1"; encoding?: "hex" | "base64" } = {},
): Promise<string> {
  const { hash = "SHA-256", encoding = "hex" } = options;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return encoding === "base64" ? toBase64(digest) : toHex(digest);
}

export interface VerifyHmacSignatureOptions {
  /** Hash algorithm backing the HMAC. Defaults to "SHA-256". */
  hash?: "SHA-256" | "SHA-1";
  /** Digest encoding the provided signature is expressed in. Defaults to "hex". */
  encoding?: "hex" | "base64";
  /**
   * Literal prefix the provided signature must start with (e.g. GitHub's
   * `"sha256="` on `X-Hub-Signature-256`). Stripped before comparing. A
   * signature missing this prefix is rejected. Omit for headers that carry
   * the bare digest (e.g. a custom `x-app-signature: <hex>` header).
   */
  prefix?: string;
}

/**
 * Verify an HMAC-signed webhook payload against a provided signature header
 * value. Generic building block for simple "HMAC over the raw body" schemes —
 * providers with a more structured signing input (Stripe's `t=...,v1=...`,
 * Twilio's URL+params concatenation) layer their own signing-input
 * construction on top of {@link computeHmac} / {@link timingSafeEqual} instead
 * (see `./stripe` and `./twilio`).
 *
 * Usage (GitHub `X-Hub-Signature-256`, e.g. dispatching a repo webhook):
 * ```ts
 * const ok = await verifyHmacSignature(rawBody, request.headers.get("x-hub-signature-256"), secret, {
 *   prefix: "sha256=",
 * });
 * ```
 *
 * Usage (a bare hex-digest internal callback header, no prefix):
 * ```ts
 * const ok = await verifyHmacSignature(rawBody, request.headers.get("x-app-signature"), secret);
 * ```
 */
export async function verifyHmacSignature(
  payload: string,
  providedSignature: string | null | undefined,
  secret: string,
  options: VerifyHmacSignatureOptions = {},
): Promise<boolean> {
  if (!providedSignature || !secret) return false;

  const { prefix } = options;
  let candidate = providedSignature;
  if (prefix !== undefined) {
    if (!candidate.startsWith(prefix)) return false;
    candidate = candidate.slice(prefix.length);
  }

  try {
    const expected = await computeHmac(secret, payload, options);
    // Hex digests are case-insensitive (providers vary on casing); base64
    // digests are case-sensitive and must compare exactly.
    const encoding = options.encoding ?? "hex";
    return encoding === "hex"
      ? timingSafeEqual(candidate.toLowerCase(), expected.toLowerCase())
      : timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}
