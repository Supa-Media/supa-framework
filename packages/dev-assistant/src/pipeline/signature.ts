/**
 * HMAC callback signature verification for the dev-assistant `/callback` and
 * `/upload` HTTP routes.
 *
 * This is an INLINED copy of the generic verifier from
 * `@supa-media/convex/webhooks` (`verifyHmacSignature` / `timingSafeEqual`,
 * `packages/convex/src/webhooks/hmac.ts`). It is inlined deliberately rather
 * than imported: there is no precedent in this monorepo for one `@supa-media/*`
 * raw-TypeScript package depending on another (verified — no `workspace:` deps
 * and no `@supa-media/*` in any dependency block), and the house style there is
 * to keep each raw-TS Convex package dependency-free (the `convex` package
 * itself inlines its Web-Crypto HMAC rather than pulling a sibling). Keeping the
 * copy here also makes this package's tests hermetic. If the two ever diverge,
 * `@supa-media/convex/webhooks` is the canonical source of truth.
 *
 * Web Crypto only (`crypto.subtle`) — Convex's runtime has no `node:crypto`.
 */

/**
 * Constant-time string comparison to prevent timing attacks. Compares every
 * character regardless of where a mismatch occurs.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** Compute an HMAC-SHA256 digest of `message` and encode it as lowercase hex. */
export async function computeHmacHex(
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify an HMAC-SHA256-over-the-raw-body signature (hex digest, no prefix) —
 * the scheme the Routine uses to sign its callbacks and uploads. Recompute and
 * constant-time compare (case-insensitively, since providers vary on casing).
 */
export async function verifyCallbackSignature(
  payload: string,
  providedSignature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!providedSignature || !secret) return false;
  try {
    const expected = await computeHmacHex(secret, payload);
    return timingSafeEqual(providedSignature.toLowerCase(), expected.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Verify a GitHub webhook signature (`X-Hub-Signature-256`): `sha256=<hex>`.
 * Same HMAC-SHA256 + constant-time compare, with the `sha256=` prefix stripped.
 */
export async function verifyGithubSignature(
  payload: string,
  providedSignature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!providedSignature || !secret) return false;
  const prefix = "sha256=";
  if (!providedSignature.startsWith(prefix)) return false;
  const candidate = providedSignature.slice(prefix.length).toLowerCase();
  try {
    const expected = await computeHmacHex(secret, payload);
    return timingSafeEqual(candidate, expected.toLowerCase());
  } catch {
    return false;
  }
}
