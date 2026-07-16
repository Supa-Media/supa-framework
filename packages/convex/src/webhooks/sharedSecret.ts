/**
 * Shared-secret header verification.
 *
 * Not every inbound webhook is HMAC-signed. Fount Studios' Resend inbound-email
 * handler (`apps/convex/lib/webhooks/resend.ts`, `shouldDropInbound`) is a real
 * example: Resend does not sign inbound webhook payloads (no Svix/HMAC scheme
 * in play there), so the production guard is a constant shared-secret header
 * (`x-inbound-test-secret`) compared against an env var, used to gate
 * non-production deployments from ingesting real mail. This helper generalizes
 * that comparison — do not reach for `verifyHmacSignature` when a provider
 * genuinely has no signing scheme; a plain shared secret is what fount's
 * production code actually does here.
 *
 * Deviation from fount's inline version: the original does a plain `!==`
 * string compare (fine for a low-value dev/test gate secret). This helper
 * uses a timing-safe compare instead, since it's meant to be reused for
 * higher-value secrets too.
 */
import { timingSafeEqual } from "./hmac";

/** Minimal header-reader interface — matches both `Request.headers` and a plain `Headers` instance. */
interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Verify a request carries the expected value in a given header, via a
 * timing-safe comparison. Returns `false` if the expected secret is unset
 * (nothing to compare against) or the header is missing/mismatched.
 *
 * Usage:
 * ```ts
 * // convex/http.ts — Resend inbound email (no signing scheme; shared secret only)
 * import { verifySharedSecretHeader } from "@supa-media/convex/webhooks";
 *
 * const ok = verifySharedSecretHeader(request.headers, "x-inbound-test-secret", process.env.INBOUND_TEST_SECRET);
 * ```
 */
export function verifySharedSecretHeader(
  headers: HeaderReader,
  headerName: string,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;
  const provided = headers.get(headerName);
  if (provided === null) return false;
  return timingSafeEqual(provided, expectedSecret);
}
