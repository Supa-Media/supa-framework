import { describe, expect, test } from "vitest";

import {
  computeHmacHex,
  MAX_CLOCK_SKEW_MS,
  signingString,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  timingSafeEqual,
  verifyReadToken,
  verifySignedRequest,
} from "../convex/lib/auth";

const SECRET = "fleet-backend-secret";
const NOW = 1_800_000_000_000;

async function signedHeaders(body: string, timestamp = String(NOW)): Promise<Headers> {
  return new Headers({
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: await computeHmacHex(SECRET, signingString(timestamp, body)),
  });
}

describe("timingSafeEqual", () => {
  test("equal strings match, different ones do not", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  test("a length mismatch is false rather than a prefix match", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "a")).toBe(false);
  });
});

describe("computeHmacHex", () => {
  /**
   * RFC 4231 test case 1. Pinned so a refactor of the Web Crypto call cannot
   * quietly change the digest — every writer in the fleet would keep signing
   * and start being rejected, with no local test to say why.
   */
  test("matches the RFC 4231 vector", async () => {
    const key = "\x0b".repeat(20);
    expect(await computeHmacHex(key, "Hi There")).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  test("is lowercase hex of a fixed width", async () => {
    const digest = await computeHmacHex(SECRET, "anything");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifySignedRequest", () => {
  const body = JSON.stringify({ source: "watchdog", repo: "a/b", kind: "wake" });

  test("accepts a correctly signed request", async () => {
    const result = await verifySignedRequest(body, await signedHeaders(body), SECRET, NOW);
    expect(result.ok).toBe(true);
  });

  test("503s when the secret is unset — an unconfigured backend must not fall open", async () => {
    const headers = await signedHeaders(body);
    expect(await verifySignedRequest(body, headers, undefined, NOW)).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(await verifySignedRequest(body, headers, "", NOW)).toMatchObject({
      ok: false,
      status: 503,
    });
  });

  test("401s with no signature headers at all", async () => {
    const result = await verifySignedRequest(body, new Headers(), SECRET, NOW);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  test("401s when only the timestamp is present", async () => {
    const headers = new Headers({ [TIMESTAMP_HEADER]: String(NOW) });
    expect(await verifySignedRequest(body, headers, SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  test("401s on a non-numeric timestamp", async () => {
    const headers = await signedHeaders(body, "yesterday");
    expect(await verifySignedRequest(body, headers, SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
      message: expect.stringContaining("unix milliseconds"),
    });
  });

  test("401s on the wrong secret", async () => {
    const timestamp = String(NOW);
    const headers = new Headers({
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: await computeHmacHex("not-the-secret", signingString(timestamp, body)),
    });
    expect(await verifySignedRequest(body, headers, SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
      message: "Invalid signature",
    });
  });

  test("401s when the body was edited after signing", async () => {
    const headers = await signedHeaders(body);
    const tampered = body.replace("wake", "respawn");
    expect(await verifySignedRequest(tampered, headers, SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  /**
   * The whole reason this backend signs a timestamp when the dev-assistant it
   * borrows the pattern from does not: `runEvents` is append-only, so nothing
   * downstream makes a replay illegal.
   */
  test("401s on a capture replayed outside the window, in either direction", async () => {
    const stale = String(NOW - MAX_CLOCK_SKEW_MS - 1);
    const future = String(NOW + MAX_CLOCK_SKEW_MS + 1);
    expect(await verifySignedRequest(body, await signedHeaders(body, stale), SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
      message: expect.stringContaining("outside the accepted window"),
    });
    expect(await verifySignedRequest(body, await signedHeaders(body, future), SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  test("accepts a clock at the edge of the window", async () => {
    const edge = String(NOW - MAX_CLOCK_SKEW_MS);
    const result = await verifySignedRequest(body, await signedHeaders(body, edge), SECRET, NOW);
    expect(result.ok).toBe(true);
  });

  test("the timestamp cannot be swapped to refresh a stale capture", async () => {
    // A capture signed long ago, re-presented with a fresh timestamp header.
    const old = String(NOW - 60 * 60 * 1000);
    const captured = await signedHeaders(body, old);
    captured.set(TIMESTAMP_HEADER, String(NOW));
    expect(await verifySignedRequest(body, captured, SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
      message: "Invalid signature",
    });
  });

  test("an uppercase hex digest is accepted", async () => {
    const timestamp = String(NOW);
    const digest = await computeHmacHex(SECRET, signingString(timestamp, body));
    const headers = new Headers({
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: digest.toUpperCase(),
    });
    expect((await verifySignedRequest(body, headers, SECRET, NOW)).ok).toBe(true);
  });
});

describe("verifyReadToken", () => {
  const TOKEN = "fleet-read-token";

  test("accepts the right token, in either header casing of the scheme", () => {
    expect(verifyReadToken(new Headers({ Authorization: `Bearer ${TOKEN}` }), TOKEN).ok).toBe(true);
    expect(verifyReadToken(new Headers({ Authorization: `bearer ${TOKEN}` }), TOKEN).ok).toBe(true);
  });

  test("503s when the token is unset", () => {
    expect(verifyReadToken(new Headers({ Authorization: "Bearer x" }), undefined)).toMatchObject({
      ok: false,
      status: 503,
    });
  });

  test("401s with no header", () => {
    expect(verifyReadToken(new Headers(), TOKEN)).toMatchObject({ ok: false, status: 401 });
  });

  test("401s on a non-Bearer scheme or an empty credential", () => {
    expect(verifyReadToken(new Headers({ Authorization: `Basic ${TOKEN}` }), TOKEN)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(verifyReadToken(new Headers({ Authorization: "Bearer " }), TOKEN)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(verifyReadToken(new Headers({ Authorization: TOKEN }), TOKEN)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  test("401s on a wrong token, including a prefix of the right one", () => {
    expect(verifyReadToken(new Headers({ Authorization: "Bearer nope" }), TOKEN)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      verifyReadToken(new Headers({ Authorization: `Bearer ${TOKEN.slice(0, -1)}` }), TOKEN),
    ).toMatchObject({ ok: false, status: 401 });
  });
});
