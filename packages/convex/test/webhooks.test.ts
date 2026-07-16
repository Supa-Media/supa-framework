/**
 * Vector tests for `@supa-media/convex/webhooks`.
 *
 * Signature verification is exactly the kind of code that deserves a vector
 * test: expected digests are computed independently with Node's built-in
 * `node:crypto` (not by calling our own `computeHmac`), so a bug in the
 * implementation under test can't also corrupt the expected value.
 *
 * Run: `node --import ./test/register.mjs --test test/*.test.ts`
 * (see `./ts-loader.mjs` for why the import hook is needed — this package
 * ships raw TS with extensionless relative imports, meant for a bundler.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  verifyHmacSignature,
  computeHmac,
  timingSafeEqual,
} from "../src/webhooks/hmac";
import { verifyStripeSignature } from "../src/webhooks/stripe";
import { verifyTwilioSignature } from "../src/webhooks/twilio";
import { verifySharedSecretHeader } from "../src/webhooks/sharedSecret";

// ---------------------------------------------------------------------------
// timingSafeEqual
// ---------------------------------------------------------------------------

test("timingSafeEqual: equal strings match", () => {
  assert.equal(timingSafeEqual("abc123", "abc123"), true);
});

test("timingSafeEqual: different strings don't match", () => {
  assert.equal(timingSafeEqual("abc123", "abc124"), false);
});

test("timingSafeEqual: different lengths don't match", () => {
  assert.equal(timingSafeEqual("abc", "abcd"), false);
});

// ---------------------------------------------------------------------------
// verifyHmacSignature (generic core) — GitHub X-Hub-Signature-256-style
// ---------------------------------------------------------------------------

test("verifyHmacSignature: accepts a valid hex signature with prefix (GitHub-style)", async () => {
  const secret = "gh-webhook-secret";
  const payload = JSON.stringify({ action: "opened", number: 42 });
  const expectedHex = createHmac("sha256", secret).update(payload).digest("hex");

  const ok = await verifyHmacSignature(payload, `sha256=${expectedHex}`, secret, {
    prefix: "sha256=",
  });
  assert.equal(ok, true);
});

test("verifyHmacSignature: rejects when the prefix is missing", async () => {
  const secret = "gh-webhook-secret";
  const payload = "hello world";
  const expectedHex = createHmac("sha256", secret).update(payload).digest("hex");

  const ok = await verifyHmacSignature(payload, expectedHex, secret, {
    prefix: "sha256=",
  });
  assert.equal(ok, false);
});

test("verifyHmacSignature: accepts a bare hex signature with no prefix (internal callback-style)", async () => {
  const secret = "callback-secret";
  const payload = JSON.stringify({ status: "completed" });
  const expectedHex = createHmac("sha256", secret).update(payload).digest("hex");

  const ok = await verifyHmacSignature(payload, expectedHex, secret);
  assert.equal(ok, true);
});

test("verifyHmacSignature: rejects a tampered payload", async () => {
  const secret = "callback-secret";
  const payload = "original body";
  const expectedHex = createHmac("sha256", secret).update(payload).digest("hex");

  const ok = await verifyHmacSignature("tampered body", expectedHex, secret);
  assert.equal(ok, false);
});

test("verifyHmacSignature: rejects the wrong secret", async () => {
  const payload = "hello world";
  const expectedHex = createHmac("sha256", "right-secret").update(payload).digest("hex");

  const ok = await verifyHmacSignature(payload, expectedHex, "wrong-secret");
  assert.equal(ok, false);
});

test("verifyHmacSignature: rejects a missing signature", async () => {
  const ok = await verifyHmacSignature("payload", null, "secret");
  assert.equal(ok, false);
});

test("verifyHmacSignature: rejects an empty secret", async () => {
  const ok = await verifyHmacSignature("payload", "deadbeef", "");
  assert.equal(ok, false);
});

test("verifyHmacSignature: hex comparison is case-insensitive", async () => {
  const secret = "s3cr3t";
  const payload = "case test";
  const expectedHex = createHmac("sha256", secret).update(payload).digest("hex");

  const ok = await verifyHmacSignature(payload, expectedHex.toUpperCase(), secret);
  assert.equal(ok, true);
});

test("verifyHmacSignature: SHA-1 + base64 option matches node:crypto", async () => {
  const secret = "sha1-secret";
  const payload = "some=form&data=here";
  const expectedB64 = createHmac("sha1", secret).update(payload).digest("base64");

  const ok = await verifyHmacSignature(payload, expectedB64, secret, {
    hash: "SHA-1",
    encoding: "base64",
  });
  assert.equal(ok, true);
});

test("computeHmac: hex output matches node:crypto for a known vector", async () => {
  const secret = "vector-secret";
  const payload = "vector-payload";
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const actual = await computeHmac(secret, payload);
  assert.equal(actual, expected);
});

// ---------------------------------------------------------------------------
// verifyStripeSignature
// ---------------------------------------------------------------------------

function buildStripeSignatureHeader(
  secret: string,
  payload: string,
  timestamp: number,
): string {
  const signedPayload = `${timestamp}.${payload}`;
  const v1 = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

test("verifyStripeSignature: accepts a valid current signature", async () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
  const header = buildStripeSignatureHeader(secret, payload, Math.floor(Date.now() / 1000));

  const ok = await verifyStripeSignature(payload, header, secret);
  assert.equal(ok, true);
});

test("verifyStripeSignature: rejects an expired timestamp (replay protection)", async () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_123" });
  const staleTimestamp = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min ago
  const header = buildStripeSignatureHeader(secret, payload, staleTimestamp);

  const ok = await verifyStripeSignature(payload, header, secret);
  assert.equal(ok, false);
});

test("verifyStripeSignature: respects a custom tolerance window", async () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_123" });
  const timestamp = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min ago
  const header = buildStripeSignatureHeader(secret, payload, timestamp);

  const ok = await verifyStripeSignature(payload, header, secret, {
    toleranceSeconds: 15 * 60,
  });
  assert.equal(ok, true);
});

test("verifyStripeSignature: accepts a second v1 signature during secret rotation", async () => {
  const oldSecret = "whsec_old";
  const newSecret = "whsec_new";
  const payload = JSON.stringify({ id: "evt_456" });
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const v1Old = createHmac("sha256", oldSecret).update(signedPayload).digest("hex");
  const v1New = createHmac("sha256", newSecret).update(signedPayload).digest("hex");
  const header = `t=${timestamp},v1=${v1Old},v1=${v1New}`;

  // Verifying against the NEW secret must still pass because one of the two
  // v1 candidates matches it.
  const ok = await verifyStripeSignature(payload, header, newSecret);
  assert.equal(ok, true);
});

test("verifyStripeSignature: rejects a tampered payload", async () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ amount: 1000 });
  const header = buildStripeSignatureHeader(secret, payload, Math.floor(Date.now() / 1000));

  const ok = await verifyStripeSignature(
    JSON.stringify({ amount: 100000 }),
    header,
    secret,
  );
  assert.equal(ok, false);
});

test("verifyStripeSignature: rejects a malformed header", async () => {
  const ok = await verifyStripeSignature("payload", "not-a-valid-header", "secret");
  assert.equal(ok, false);
});

test("verifyStripeSignature: rejects a missing header", async () => {
  const ok = await verifyStripeSignature("payload", null, "secret");
  assert.equal(ok, false);
});

// ---------------------------------------------------------------------------
// verifyTwilioSignature
// ---------------------------------------------------------------------------

function buildTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let signingInput = url;
  for (const key of sortedKeys) {
    signingInput += key + params[key];
  }
  return createHmac("sha1", authToken).update(signingInput).digest("base64");
}

test("verifyTwilioSignature: accepts a valid signature (computed independently)", async () => {
  const authToken = "test-auth-token";
  const url = "https://example.com/twilio/sms";
  const params = { MessageSid: "SM123", From: "+12132925320", To: "+19295550100" };
  const signature = buildTwilioSignature(authToken, url, params);

  const ok = await verifyTwilioSignature({
    url,
    params,
    signatureHeader: signature,
    authToken,
  });
  assert.equal(ok, true);
});

test("verifyTwilioSignature: matches Fount Studios' production fixture exactly", async () => {
  // Ported verbatim from fount-studios/apps/convex/__tests__/twilio-webhook-signature.test.ts
  // — asserts this port's signing-input construction is byte-for-byte
  // identical to the production implementation it was extracted from.
  const authToken = "test-auth-token";
  const url = "https://example.com/twilio/sms";
  const params = {
    MessageSid: "SM123",
    From: "+12132925320",
    To: "+19295550100",
    Body: "(Giggster) Test M.: hello",
  };
  const fountFixtureSignature = "XqsM9I6PKIApLBc3bCz4FqVoHlc=";

  const ok = await verifyTwilioSignature({
    url,
    params,
    signatureHeader: fountFixtureSignature,
    authToken,
  });
  assert.equal(ok, true);
});

test("verifyTwilioSignature: is insensitive to input param key order (canonical sort)", async () => {
  const authToken = "test-auth-token";
  const url = "https://example.com/twilio/sms";
  const params = { To: "+19295550100", MessageSid: "SM123", From: "+12132925320" };
  const signature = buildTwilioSignature(authToken, url, params);

  const reordered = { From: params.From, To: params.To, MessageSid: params.MessageSid };
  const ok = await verifyTwilioSignature({
    url,
    params: reordered,
    signatureHeader: signature,
    authToken,
  });
  assert.equal(ok, true);
});

test("verifyTwilioSignature: rejects when the URL differs from what was signed", async () => {
  const authToken = "test-auth-token";
  const url = "https://example.com/twilio/sms";
  const params = { MessageSid: "SM123" };
  const signature = buildTwilioSignature(authToken, url, params);

  const ok = await verifyTwilioSignature({
    url: url + "?extra=param",
    params,
    signatureHeader: signature,
    authToken,
  });
  assert.equal(ok, false);
});

test("verifyTwilioSignature: rejects a missing signature header", async () => {
  const ok = await verifyTwilioSignature({
    url: "https://example.com",
    params: {},
    signatureHeader: null,
    authToken: "token",
  });
  assert.equal(ok, false);
});

test("verifyTwilioSignature: rejects an empty auth token", async () => {
  const ok = await verifyTwilioSignature({
    url: "https://example.com",
    params: {},
    signatureHeader: "AAAA",
    authToken: "",
  });
  assert.equal(ok, false);
});

// ---------------------------------------------------------------------------
// verifySharedSecretHeader (Resend-style — no signing scheme, shared secret only)
// ---------------------------------------------------------------------------

function fakeHeaders(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

test("verifySharedSecretHeader: accepts a matching header value", () => {
  const headers = fakeHeaders({ "x-inbound-test-secret": "let-me-in" });
  const ok = verifySharedSecretHeader(headers, "x-inbound-test-secret", "let-me-in");
  assert.equal(ok, true);
});

test("verifySharedSecretHeader: rejects a mismatched header value", () => {
  const headers = fakeHeaders({ "x-inbound-test-secret": "wrong" });
  const ok = verifySharedSecretHeader(headers, "x-inbound-test-secret", "let-me-in");
  assert.equal(ok, false);
});

test("verifySharedSecretHeader: rejects a missing header", () => {
  const headers = fakeHeaders({});
  const ok = verifySharedSecretHeader(headers, "x-inbound-test-secret", "let-me-in");
  assert.equal(ok, false);
});

test("verifySharedSecretHeader: rejects when no expected secret is configured", () => {
  const headers = fakeHeaders({ "x-inbound-test-secret": "anything" });
  const ok = verifySharedSecretHeader(headers, "x-inbound-test-secret", undefined);
  assert.equal(ok, false);
});
