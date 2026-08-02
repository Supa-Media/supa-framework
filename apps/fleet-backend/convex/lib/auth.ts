/**
 * The two credentials this backend has, and nothing else.
 *
 * There are no Convex auth providers in v1 and no user table: the fleet has one
 * human and a handful of CI jobs, so identity is a shared secret rather than a
 * login. Two secrets, because the two callers can do genuinely different things:
 *
 *   FLEET_BACKEND_SECRET — held by CI (overnight runs, the watchdog, the
 *     decider, gardeners). Signs a request body. Grants **telemetry ingest
 *     only**. A leaked one can write junk events; it cannot read your review
 *     state or anything else.
 *
 *   FLEET_READ_TOKEN — held by the human's browser, beside the GitHub PATs it
 *     already keeps in localStorage. Grants **reads, plus writes to your own
 *     review marker** — the marker is about you, and the browser is the only
 *     thing that knows you looked. It cannot write telemetry, so a token
 *     recovered from a laptop cannot forge a watchdog intervention.
 *
 * Both are read straight from `process.env` at request time, like the
 * dev-assistant's callback secret. Unset means the route answers 503 rather
 * than falling open — a backend nobody configured must not accept writes from
 * anybody who guesses the empty string.
 *
 * The HMAC helpers below are deliberately a local copy of
 * `@supa-media/dev-assistant`'s `pipeline/signature.ts`, for the same reason
 * that file gives for being a copy of `@supa-media/convex/webhooks`: raw-TS
 * Convex packages in this framework do not depend on each other, and pulling in
 * a PR-contribution-pipeline package to reach fifteen lines of Web Crypto would
 * be reuse in name only. What is NOT copied is the replay story — see
 * `verifySignedRequest`.
 */

/** Header carrying the hex HMAC digest. No `sha256=` prefix; this is not GitHub. */
export const SIGNATURE_HEADER = "x-fleet-signature";
/** Header carrying the unix-millisecond timestamp that is signed with the body. */
export const TIMESTAMP_HEADER = "x-fleet-timestamp";

/**
 * How far a signed request's timestamp may be from ours, either way.
 *
 * Five minutes is enough for a CI runner with a lazy clock and short enough
 * that a captured request stops working before anyone has read the log it
 * leaked into.
 */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Constant-time string comparison.
 *
 * Not `crypto.timingSafeEqual`: the Convex runtime is a V8 isolate with no
 * `node:crypto`. Every character is compared regardless of where a mismatch
 * occurs.
 *
 * The early length check leaks a length, and this function has two callers, so
 * the digest argument only covers one of them. For `verifySignedRequest` it
 * leaks nothing: the comparand is always a 64-character hex digest, public by
 * construction. For `verifyReadToken` it is one integer about an
 * operator-chosen secret. Stated rather than waved at — though the token
 * DEPLOY.md tells you to generate is `openssl rand -hex 32`, whose length is
 * already known to anyone reading that file. Hashing both sides to a fixed
 * width first would close it if a token ever stops being fixed-width.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** HMAC-SHA256 of `message` under `secret`, lowercase hex. */
export async function computeHmacHex(secret: string, message: string): Promise<string> {
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
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The exact string a writer signs: `<timestamp>.<raw body>`.
 *
 * Exported because the README's curl recipe and the tests both have to produce
 * it byte for byte, and a second spelling of it somewhere is the one thing that
 * would make a correct client look like an attacker.
 */
export function signingString(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

export type AuthFailure = { ok: false; status: number; message: string };
export type AuthResult = { ok: true } | AuthFailure;

/**
 * Verify an HMAC-signed ingest request.
 *
 * **Why a timestamp at all**, when the dev-assistant this pattern comes from has
 * none: that pipeline's replay defence is structural — its bug lifecycle is a
 * monotonic state machine, so a replayed callback claims a status the item has
 * already passed and is rejected as an illegal transition. `runEvents` is an
 * append-only log with no state machine to make a replay illegal, so a captured
 * POST would otherwise duplicate itself forever. The timestamp is inside the
 * signed string, so it cannot be edited to refresh a stale capture.
 *
 * This bounds the replay window; it does not close it. Within the window, an
 * exactly-repeated request is deduped by `dedupeKey` when the writer supplies
 * one — see `convex/runEvents.ts`.
 */
export async function verifySignedRequest(
  body: string,
  headers: Headers,
  secret: string | undefined,
  now: number,
): Promise<AuthResult> {
  if (secret === undefined || secret === "") {
    return { ok: false, status: 503, message: "FLEET_BACKEND_SECRET is not configured" };
  }

  const timestamp = headers.get(TIMESTAMP_HEADER);
  const signature = headers.get(SIGNATURE_HEADER);
  if (timestamp === null || signature === null) {
    return {
      ok: false,
      status: 401,
      message: `Missing ${TIMESTAMP_HEADER} or ${SIGNATURE_HEADER} header`,
    };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, status: 401, message: `${TIMESTAMP_HEADER} must be unix milliseconds` };
  }
  if (Math.abs(now - sentAt) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, status: 401, message: "Signature timestamp is outside the accepted window" };
  }

  const expected = await computeHmacHex(secret, signingString(timestamp, body));
  if (!timingSafeEqual(signature.toLowerCase(), expected)) {
    return { ok: false, status: 401, message: "Invalid signature" };
  }
  return { ok: true };
}

/**
 * Verify the reader's bearer token.
 *
 * Compared constant-time for the same reason the signature is: the token is a
 * fixed secret that a patient caller could otherwise recover a character at a
 * time. `Bearer ` is matched case-insensitively because that is what RFC 6750
 * says and what fetch wrappers do.
 */
export function verifyReadToken(headers: Headers, token: string | undefined): AuthResult {
  if (token === undefined || token === "") {
    return { ok: false, status: 503, message: "FLEET_READ_TOKEN is not configured" };
  }
  const header = headers.get("authorization");
  if (header === null) {
    return { ok: false, status: 401, message: "Missing Authorization header" };
  }
  const [scheme, ...rest] = header.split(" ");
  const presented = rest.join(" ");
  if (scheme === undefined || scheme.toLowerCase() !== "bearer" || presented === "") {
    return { ok: false, status: 401, message: "Authorization must be a Bearer token" };
  }
  if (!timingSafeEqual(presented, token)) {
    return { ok: false, status: 401, message: "Invalid read token" };
  }
  return { ok: true };
}
